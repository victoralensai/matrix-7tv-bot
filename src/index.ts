import { loadConfig } from "./config";
import { createBot } from "./bot";
import { LogService } from "matrix-bot-sdk";
import * as fs from "fs";
import { PackChoice, PackScope, SelectionManager } from "./session/selectionManager";
import { isValidEmoteName, parseAddEmoteCommand } from "./commands/addEmote";
import { getHelpMessage } from "./commands/help";
import { SevenTvService } from "./services/sevenTv";
import { EmotePackService } from "./services/emotePack";
import { MediaUploadService } from "./services/mediaUpload";
import { parseAddEmoteByLinkCommand } from "./commands/addEmoteByLink";

type BotClient = Awaited<ReturnType<typeof createBot>>;

interface PackSelectionOption {
  number: number;
  action:
    | { kind: "existing"; packChoiceIndex: number }
    | { kind: "create"; scope: PackScope; roomId: string; roomDisplayName: string };
}

async function main() {
  const config = loadConfig();
  const selectionManager = new SelectionManager(config.selectionTimeoutMs);
  const sevenTv = new SevenTvService();

  if (!fs.existsSync(config.dataPath)) {
    fs.mkdirSync(config.dataPath, { recursive: true });
  }

  LogService.info("index", "Starting Matrix 7TV Bot...");
  LogService.info("index", `Homeserver: ${config.homeserverUrl}`);
  LogService.info("index", `Bot User ID: ${config.botUserId}`);

  const client = await createBot(config);
  const emotePackService = new EmotePackService(client);
  const mediaUploadService = new MediaUploadService(client);
  const botUserId = await client.getUserId();

  setInterval(() => {
    const removed = selectionManager.cleanupExpiredSessions();
    if (removed > 0) {
      LogService.info("session", `Cleaned up ${removed} expired session(s)`);
    }
  }, Math.max(5000, Math.floor(config.selectionTimeoutMs / 2)));

  client.on("room.message", async (roomId: string, event: any) => {
    if (event.sender === config.botUserId) return;
    if (event.content?.msgtype !== "m.text") return;

    const body: string = event.content.body || "";
    const trimmed = body.trim();
    const userId: string = event.sender;

    if (trimmed === "/help" || trimmed === "/7tv-help") {
      await client.sendText(roomId, getHelpMessage());
      return;
    }

    if (trimmed === "/cancel") {
      const cancelled = selectionManager.clearSession(userId, roomId);
      await client.sendText(
        roomId,
        cancelled ? "Selection cancelled." : "No active selection to cancel."
      );
      return;
    }

    if (trimmed === "/add-emote") {
      await client.sendText(roomId, "Usage: /add-emote <search query>");
      return;
    }

    if (trimmed === "/add-emote-by-link") {
      await client.sendText(roomId, "Usage: /add-emote-by-link <7tv emote URL or ID>");
      return;
    }

    const addEmoteByLinkCommand = parseAddEmoteByLinkCommand(trimmed);
    if (addEmoteByLinkCommand) {
      try {
        const emote = await sevenTv.getEmoteById(addEmoteByLinkCommand.emoteId);
        const emoteCandidates = [
          {
            id: emote.id,
            name: emote.name,
            animated: emote.animated,
            webpUrl: sevenTv.getBestWebpUrl(emote),
          },
        ];

        selectionManager.startEmoteSelection(userId, roomId, addEmoteByLinkCommand.originalLink, emoteCandidates, {
          preselectedEmoteIndex: 0,
        });

        await sendDirectSelectionPreview(client, mediaUploadService, roomId, emoteCandidates[0]);
        await promptForPackSelection(client, selectionManager, emotePackService, botUserId, userId, roomId);
      } catch (error) {
        LogService.error("7tv", "Fetch by link failed", error);
        await client.sendText(roomId, getAddEmoteErrorMessage(error));
      }
      return;
    }

    const addEmoteCommand = parseAddEmoteCommand(trimmed);
    if (addEmoteCommand) {
      let results;
      try {
        results = await sevenTv.searchEmotes(addEmoteCommand.query, 5);
      } catch (error) {
        LogService.error("7tv", "Search failed", error);
        await client.sendText(roomId, "7TV search failed. Please try again later.");
        return;
      }

      if (results.length === 0) {
        await client.sendText(roomId, `No 7TV emotes found for "${addEmoteCommand.query}".`);
        return;
      }

      const emoteCandidates = results.map((emote) => ({
        id: emote.id,
        name: emote.name,
        animated: emote.animated,
        webpUrl: sevenTv.getBestWebpUrl(emote),
      }));

      selectionManager.startEmoteSelection(userId, roomId, addEmoteCommand.query, emoteCandidates);
      await sendSearchResultsWithPreviews(
        client,
        mediaUploadService,
        roomId,
        addEmoteCommand.query,
        emoteCandidates
      );

      return;
    }

    const session = selectionManager.getSession(userId, roomId);
    if (!session) {
      return;
    }

    if (trimmed.toLowerCase() === "cancel") {
      selectionManager.clearSession(userId, roomId);
      await client.sendText(roomId, "Selection cancelled.");
      return;
    }

    if (session.step === "pick_emote") {
      const selectedIndex = Number(trimmed);
      if (
        !Number.isInteger(selectedIndex) ||
        selectedIndex < 1 ||
        selectedIndex > session.emoteCandidates.length
      ) {
        await client.sendText(
          roomId,
          `Please reply with a number between 1 and ${session.emoteCandidates.length}, or "cancel".`
        );
        return;
      }

      selectionManager.updateSession(userId, roomId, {
        step: "pick_pack",
        selectedEmoteIndex: selectedIndex - 1,
      });

      await promptForPackSelection(client, selectionManager, emotePackService, botUserId, userId, roomId);
      return;
    }

    if (session.step === "pick_pack") {
      const targets = await emotePackService.getEditablePackTargets(botUserId, roomId);
      const existingChoices = toPackChoices(targets);
      const canCreateRoom = await emotePackService.canUserEditRoomPack(botUserId, roomId);
      const canCreateSpace =
        Boolean(targets.canonicalSpaceId) &&
        (await emotePackService.canUserEditRoomPack(botUserId, targets.canonicalSpaceId as string));
      const options = buildPackSelectionOptions(existingChoices, targets.canonicalSpaceId, canCreateRoom, canCreateSpace);

      const selectedOptionNumber = Number(trimmed);
      if (!Number.isInteger(selectedOptionNumber)) {
        await client.sendText(roomId, 'Please reply with a number from the pack list, or "cancel".');
        return;
      }

      const selectedOption = options.find((option) => option.number === selectedOptionNumber);
      if (!selectedOption) {
        await client.sendText(roomId, 'Please reply with a number from the pack list, or "cancel".');
        return;
      }

      if (selectedOption.action.kind === "create") {
        selectionManager.updateSession(userId, roomId, {
          step: "confirm_pack_name",
          packChoices: existingChoices,
          selectedPackChoiceIndex: undefined,
          newPackScope: selectedOption.action.scope,
          newPackRoomId: selectedOption.action.roomId,
          newPackRoomDisplayName: selectedOption.action.roomDisplayName,
        });

        await client.sendText(
          roomId,
          `Name for the new ${selectedOption.action.scope} pack in ${selectedOption.action.roomDisplayName}?`
        );
        return;
      }

      const selectedPack = existingChoices[selectedOption.action.packChoiceIndex];
      if (!selectedPack) {
        await client.sendText(roomId, "Selected pack is no longer available. Please choose again.");
        await promptForPackSelection(client, selectionManager, emotePackService, botUserId, userId, roomId);
        return;
      }

      selectionManager.updateSession(userId, roomId, {
        step: "confirm_name",
        packChoices: existingChoices,
        selectedPackChoiceIndex: selectedOption.action.packChoiceIndex,
        newPackScope: undefined,
        newPackRoomId: undefined,
        newPackRoomDisplayName: undefined,
      });

      const selectedIndex = session.selectedEmoteIndex ?? 0;
      const selectedEmoteName = session.emoteCandidates[selectedIndex]?.name || "unknown";
      await client.sendText(
        roomId,
        [
          `Pack: ${selectedPack.displayName} (${selectedPack.scope === "space" ? "space" : "room"})`,
          `Name for emote (default: ${selectedEmoteName}). Reply with a name or "ok" to use default.`,
        ].join("\n")
      );
      return;
    }

    if (session.step === "confirm_pack_name") {
      const rawName = trimmed;
      if (!rawName) {
        await client.sendText(roomId, "Pack name cannot be empty. Reply with a valid pack name or cancel.");
        return;
      }

      if (Buffer.byteLength(rawName, "utf8") > 80) {
        await client.sendText(roomId, "Pack name is too long. Please keep it under 80 bytes.");
        return;
      }

      const newPackRoomId = session.newPackRoomId;
      const newPackScope = session.newPackScope;
      const newPackRoomDisplayName = session.newPackRoomDisplayName;
      if (!newPackRoomId || !newPackScope || !newPackRoomDisplayName) {
        selectionManager.clearSession(userId, roomId);
        await client.sendText(roomId, "Selection expired or invalid. Please run /add-emote again.");
        return;
      }

      const existingRoomPacks = await emotePackService.listRoomPacks(newPackRoomId);
      const existingStateKeys = new Set(existingRoomPacks.map((pack) => pack.stateKey));
      const stateKey = generateUniqueStateKey(rawName, existingStateKeys);

      const existingChoices = session.packChoices ?? [];
      const appendedPack: PackChoice = {
        scope: newPackScope,
        roomId: newPackRoomId,
        roomDisplayName: newPackRoomDisplayName,
        stateKey,
        displayName: rawName,
      };

      selectionManager.updateSession(userId, roomId, {
        step: "confirm_name",
        packChoices: [...existingChoices, appendedPack],
        selectedPackChoiceIndex: existingChoices.length,
        newPackScope: undefined,
        newPackRoomId: undefined,
        newPackRoomDisplayName: undefined,
      });

      const selectedIndex = session.selectedEmoteIndex ?? 0;
      const selectedEmoteName = session.emoteCandidates[selectedIndex]?.name || "unknown";
      await client.sendText(
        roomId,
        [
          `Created pack target: ${rawName} (${newPackScope})`,
          `Name for emote (default: ${selectedEmoteName}). Reply with a name or "ok" to use default.`,
        ].join("\n")
      );
      return;
    }

    if (session.step === "confirm_name") {
      const selectedIndex = session.selectedEmoteIndex ?? 0;
      const selectedEmote = session.emoteCandidates[selectedIndex];
      const defaultName = selectedEmote?.name || "emote";
      const finalName = trimmed.toLowerCase() === "ok" ? defaultName : trimmed;

      if (!finalName) {
        await client.sendText(roomId, "Name cannot be empty. Reply with a valid name or \"ok\".");
        return;
      }

      if (!isValidEmoteName(finalName)) {
        await client.sendText(
          roomId,
          "Invalid emote name. Use only letters, numbers, '-' or '_', max 100 bytes."
        );
        return;
      }

      if (!selectedEmote) {
        selectionManager.clearSession(userId, roomId);
        await client.sendText(roomId, "Selection expired or invalid. Please run /add-emote again.");
        return;
      }

      const packChoices = session.packChoices ?? [];
      const selectedPackIndex = session.selectedPackChoiceIndex ?? -1;
      const selectedPack = packChoices[selectedPackIndex];
      if (!selectedPack) {
        selectionManager.clearSession(userId, roomId);
        await client.sendText(roomId, "Pack selection expired. Please run /add-emote again.");
        return;
      }

      const shortcodeExists = await emotePackService.roomPackHasShortcode(
        selectedPack.roomId,
        finalName,
        selectedPack.stateKey
      );
      if (shortcodeExists) {
        await client.sendText(
          roomId,
          `:${finalName}: already exists in ${selectedPack.displayName}. Reply with a different name or "cancel".`
        );
        return;
      }

      try {
        const webpData = await sevenTv.downloadFromUrl(selectedEmote.webpUrl);

        const filename = `${finalName}.webp`;
        const mxcUrl = await mediaUploadService.uploadWebp(webpData, filename);

        await emotePackService.addToRoomPack(
          selectedPack.roomId,
          finalName,
          {
            url: mxcUrl,
            body: finalName,
            info: {
              mimetype: "image/webp",
              size: webpData.length,
            },
          },
          {
            packDisplayName: selectedPack.displayName,
            stateKey: selectedPack.stateKey,
          }
        );

        if (selectedPack.scope === "space") {
          await client.sendText(
            roomId,
            `Added :${finalName}: to space pack "${selectedPack.displayName}" in ${selectedPack.roomDisplayName}.`
          );
        } else {
          await client.sendText(roomId, `Added :${finalName}: to room pack "${selectedPack.displayName}".`);
        }
      } catch (error) {
        LogService.error("add-emote", "Failed to upload/add emote", error);
        await client.sendText(roomId, getAddEmoteErrorMessage(error));
      }

      selectionManager.clearSession(userId, roomId);
      return;
    }
  });

  await client.start();
  LogService.info("index", "Bot started successfully!");
}

async function sendSearchResultsWithPreviews(
  client: BotClient,
  mediaUploadService: MediaUploadService,
  roomId: string,
  query: string,
  emoteCandidates: Array<{ id: string; name: string; animated: boolean; webpUrl: string }>
): Promise<void> {
  await client.sendText(
    roomId,
    [`Found ${emoteCandidates.length} emotes for "${query}":`, "Sending previews..."].join("\n")
  );

  for (const [idx, emote] of emoteCandidates.entries()) {
    try {
      const previewMxc = await mediaUploadService.uploadFromUrl(emote.webpUrl);
      await client.sendMessage(roomId, {
        msgtype: "m.image",
        body: `${idx + 1}. ${emote.name}${emote.animated ? " (animated)" : ""}`,
        url: previewMxc,
        info: {
          mimetype: "image/webp",
        },
      });
    } catch (error) {
      LogService.warn("add-emote", `Preview upload failed for ${emote.id}`, error as Error);
      await client.sendText(
        roomId,
        `${idx + 1}. ${emote.name}${emote.animated ? " (animated)" : ""} - ${emote.webpUrl}`
      );
    }
  }

  await client.sendText(roomId, 'Reply with a number to select, or "cancel".');
}

async function sendDirectSelectionPreview(
  client: BotClient,
  mediaUploadService: MediaUploadService,
  roomId: string,
  selectedEmote: { id: string; name: string; animated: boolean; webpUrl: string }
): Promise<void> {
  await client.sendText(roomId, `Selected by link: ${selectedEmote.name}. Sending preview...`);

  try {
    const previewMxc = await mediaUploadService.uploadFromUrl(selectedEmote.webpUrl);
    await client.sendMessage(roomId, {
      msgtype: "m.image",
      body: `${selectedEmote.name}${selectedEmote.animated ? " (animated)" : ""}`,
      url: previewMxc,
      info: {
        mimetype: "image/webp",
      },
    });
  } catch (error) {
    LogService.warn("add-emote", `Preview upload failed for ${selectedEmote.id}`, error as Error);
    await client.sendText(
      roomId,
      `${selectedEmote.name}${selectedEmote.animated ? " (animated)" : ""} - ${selectedEmote.webpUrl}`
    );
  }
}

function toPackChoices(targets: Awaited<ReturnType<EmotePackService["getEditablePackTargets"]>>): PackChoice[] {
  const roomChoices: PackChoice[] = targets.roomPacks.map((pack) => ({
    scope: "room",
    roomId: pack.roomId,
    roomDisplayName: pack.roomDisplayName,
    stateKey: pack.stateKey,
    displayName: pack.displayName,
  }));
  const spaceChoices: PackChoice[] = targets.spacePacks.map((pack) => ({
    scope: "space",
    roomId: pack.roomId,
    roomDisplayName: pack.roomDisplayName,
    stateKey: pack.stateKey,
    displayName: pack.displayName,
  }));

  return [...roomChoices, ...spaceChoices];
}

function buildPackSelectionOptions(
  packChoices: PackChoice[],
  canonicalSpaceId: string | null,
  canCreateRoom: boolean,
  canCreateSpace: boolean
): PackSelectionOption[] {
  const options: PackSelectionOption[] = [];
  let nextNumber = 1;

  for (let i = 0; i < packChoices.length; i += 1) {
    options.push({
      number: nextNumber,
      action: { kind: "existing", packChoiceIndex: i },
    });
    nextNumber += 1;
  }

  if (canCreateRoom) {
    const roomChoice = packChoices.find((pack) => pack.scope === "room");
    const roomId = roomChoice?.roomId;
    const roomDisplayName = roomChoice?.roomDisplayName;
    if (roomId && roomDisplayName) {
      options.push({
        number: nextNumber,
        action: {
          kind: "create",
          scope: "room",
          roomId,
          roomDisplayName,
        },
      });
      nextNumber += 1;
    }
  }

  if (canCreateSpace && canonicalSpaceId) {
    const spaceChoice = packChoices.find(
      (pack) => pack.scope === "space" && pack.roomId === canonicalSpaceId
    );
    const roomDisplayName = spaceChoice?.roomDisplayName || canonicalSpaceId;
    options.push({
      number: nextNumber,
      action: {
        kind: "create",
        scope: "space",
        roomId: canonicalSpaceId,
        roomDisplayName,
      },
    });
  }

  return options;
}

function formatPackSelectionMessage(
  selectedEmoteName: string,
  packChoices: PackChoice[],
  options: PackSelectionOption[]
): string {
  const lines: string[] = [
    `Selected: ${selectedEmoteName}`,
    "Add to which pack?",
  ];

  for (const option of options) {
    if (option.action.kind === "existing") {
      const pack = packChoices[option.action.packChoiceIndex];
      if (pack) {
        const scopeLabel = pack.scope === "space" ? `space: ${pack.roomDisplayName}` : "this room";
        const keyLabel = pack.stateKey ? ` [${pack.stateKey}]` : " [default]";
        lines.push(`  ${option.number}. ${pack.displayName} (${scopeLabel})${keyLabel}`);
      }
      continue;
    }

    const targetLabel = option.action.scope === "space"
      ? `Create new pack in space ${option.action.roomDisplayName}`
      : "Create new pack in this room";
    lines.push(`  ${option.number}. ${targetLabel}`);
  }

  lines.push('Reply with a number, or "cancel".');
  return lines.join("\n");
}

async function promptForPackSelection(
  client: BotClient,
  selectionManager: SelectionManager,
  emotePackService: EmotePackService,
  botUserId: string,
  userId: string,
  roomId: string
): Promise<void> {
  const session = selectionManager.getSession(userId, roomId);
  if (!session) {
    return;
  }

  const selectedIndex = session.selectedEmoteIndex ?? 0;
  const selectedEmoteName = session.emoteCandidates[selectedIndex]?.name || "unknown";

  const targets = await emotePackService.getEditablePackTargets(botUserId, roomId);
  const packChoices = toPackChoices(targets);
  const canCreateRoom = await emotePackService.canUserEditRoomPack(botUserId, roomId);
  const canCreateSpace =
    Boolean(targets.canonicalSpaceId) &&
    (await emotePackService.canUserEditRoomPack(botUserId, targets.canonicalSpaceId as string));
  const options = buildPackSelectionOptions(packChoices, targets.canonicalSpaceId, canCreateRoom, canCreateSpace);

  if (options.length === 0) {
    selectionManager.clearSession(userId, roomId);
    await client.sendText(
      roomId,
      "I cannot edit room or canonical-space emote packs from here. Ask an admin to grant me state-event rights for im.ponies.room_emotes."
    );
    return;
  }

  selectionManager.updateSession(userId, roomId, {
    step: "pick_pack",
    packChoices,
    selectedPackChoiceIndex: undefined,
    newPackScope: undefined,
    newPackRoomId: undefined,
    newPackRoomDisplayName: undefined,
  });

  await client.sendText(roomId, formatPackSelectionMessage(selectedEmoteName, packChoices, options));
}

function generateUniqueStateKey(displayName: string, used: Set<string>): string {
  const base = toStateKey(displayName);
  if (!used.has(base)) {
    return base;
  }

  let counter = 2;
  while (used.has(`${base}-${counter}`)) {
    counter += 1;
  }
  return `${base}-${counter}`;
}

function toStateKey(displayName: string): string {
  const slug = displayName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_\s]+/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return slug || "pack";
}

function getAddEmoteErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unknown error";
  if (message.includes("7TV") || message.includes("cdn.7tv.app")) {
    return "Failed to download the selected emote from 7TV. Please try another result or retry later.";
  }

  if (message.includes("not found")) {
    return "That 7TV emote link or ID could not be found.";
  }

  if (message.includes("M_FORBIDDEN") || message.toLowerCase().includes("forbidden")) {
    return "Matrix rejected the update (permission denied). Please verify bot permissions and try again.";
  }

  return "Failed to add emote due to an unexpected error. Please try again.";
}

main().catch((err) => {
  LogService.error("index", "Fatal error:", err);
  process.exit(1);
});
