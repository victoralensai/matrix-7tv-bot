import { loadConfig } from "./config";
import { createBot } from "./bot";
import { LogService } from "matrix-bot-sdk";
import * as fs from "fs";
import { PackChoice, PackScope, SelectionManager } from "./session/selectionManager";
import { isValidEmoteName, parseAddEmoteCommand } from "./commands/addEmote";
import { getHelpHtmlMessage, getHelpMessage } from "./commands/help";
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

interface FormattedMessage {
  plain: string;
  html: string;
}

function textMessage(text: string): FormattedMessage {
  return { plain: text, html: escapeHtml(text) };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getThreadRootEventId(event: any): string | null {
  const relatesTo = event?.content?.["m.relates_to"];
  if (!relatesTo || relatesTo.rel_type !== "m.thread" || typeof relatesTo.event_id !== "string") {
    return null;
  }

  return relatesTo.event_id;
}

async function sendThreadText(
  client: BotClient,
  roomId: string,
  threadRootEventId: string,
  userId: string,
  message: FormattedMessage,
  mentionUser = false
): Promise<string> {
  const mentionText = mentionUser ? `${userId} ` : "";
  const mentionHtml = mentionUser
    ? `<a href=\"https://matrix.to/#/${encodeURIComponent(userId)}\">${escapeHtml(userId)}</a> `
    : "";

  return client.sendMessage(roomId, {
    msgtype: "m.text",
    body: `${mentionText}${message.plain}`,
    format: "org.matrix.custom.html",
    formatted_body: `${mentionHtml}${message.html}`,
    "m.relates_to": {
      rel_type: "m.thread",
      event_id: threadRootEventId,
    },
  });
}

async function sendThreadImage(
  client: BotClient,
  roomId: string,
  threadRootEventId: string,
  body: string,
  mxcUrl: string
): Promise<string> {
  return client.sendMessage(roomId, {
    msgtype: "m.image",
    body,
    url: mxcUrl,
    info: {
      mimetype: "image/webp",
    },
    "m.relates_to": {
      rel_type: "m.thread",
      event_id: threadRootEventId,
    },
  });
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
    if (typeof event.event_id !== "string" || event.event_id.length === 0) return;

    const body: string = event.content.body || "";
    const trimmed = body.trim();
    const userId: string = event.sender;
    const threadRootEventId = getThreadRootEventId(event);

    if (trimmed === "/help" || trimmed === "/7tv-help") {
      await sendThreadText(
        client,
        roomId,
        event.event_id,
        userId,
        {
          plain: getHelpMessage(),
          html: getHelpHtmlMessage(),
        },
        true
      );
      return;
    }

    if (trimmed === "/cancel") {
      const cancelled = selectionManager.clearSession(userId, roomId);
      await sendThreadText(
        client,
        roomId,
        threadRootEventId || event.event_id,
        userId,
        textMessage(cancelled ? "Selection cancelled." : "No active selection to cancel."),
        true
      );
      return;
    }

    if (trimmed === "/add-emote") {
      await sendThreadText(
        client,
        roomId,
        event.event_id,
        userId,
        {
          plain: "Usage: /add-emote <search query>",
          html: "<b>Usage:</b> <code>/add-emote &lt;search query&gt;</code>",
        },
        true
      );
      return;
    }

    if (trimmed === "/add-emote-by-link") {
      await sendThreadText(
        client,
        roomId,
        event.event_id,
        userId,
        {
          plain: "Usage: /add-emote-by-link <7tv emote URL or ID>",
          html: "<b>Usage:</b> <code>/add-emote-by-link &lt;7tv emote URL or ID&gt;</code>",
        },
        true
      );
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

        selectionManager.startEmoteSelection(
          userId,
          roomId,
          event.event_id,
          addEmoteByLinkCommand.originalLink,
          emoteCandidates,
          {
            preselectedEmoteIndex: 0,
          }
        );

        await sendDirectSelectionPreview(
          client,
          mediaUploadService,
          roomId,
          event.event_id,
          userId,
          emoteCandidates[0]
        );
        await promptForPackSelection(client, selectionManager, emotePackService, botUserId, userId, roomId);
      } catch (error) {
        LogService.error("7tv", "Fetch by link failed", error);
        await sendThreadText(
          client,
          roomId,
          event.event_id,
          userId,
          textMessage(getAddEmoteErrorMessage(error)),
          true
        );
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
        await sendThreadText(
          client,
          roomId,
          event.event_id,
          userId,
          textMessage("7TV search failed. Please try again later."),
          true
        );
        return;
      }

      if (results.length === 0) {
        await sendThreadText(
          client,
          roomId,
          event.event_id,
          userId,
          {
            plain: `No 7TV emotes found for "${addEmoteCommand.query}".`,
            html: `No 7TV emotes found for <b>"${escapeHtml(addEmoteCommand.query)}"</b>.`,
          },
          true
        );
        return;
      }

      const emoteCandidates = results.map((emote) => ({
        id: emote.id,
        name: emote.name,
        animated: emote.animated,
        webpUrl: sevenTv.getBestWebpUrl(emote),
      }));

      selectionManager.startEmoteSelection(
        userId,
        roomId,
        event.event_id,
        addEmoteCommand.query,
        emoteCandidates
      );
      await sendSearchResultsWithPreviews(
        client,
        mediaUploadService,
        roomId,
        event.event_id,
        userId,
        addEmoteCommand.query,
        emoteCandidates
      );

      return;
    }

    const session = selectionManager.getSession(userId, roomId);
    if (!session) {
      return;
    }

    if (!threadRootEventId || threadRootEventId !== session.threadRootEventId) {
      return;
    }

    if (trimmed.toLowerCase() === "cancel") {
      selectionManager.clearSession(userId, roomId);
      await sendThreadText(client, roomId, session.threadRootEventId, userId, textMessage("Selection cancelled."), true);
      return;
    }

    if (session.step === "pick_emote") {
      const selectedIndex = Number(trimmed);
      if (
        !Number.isInteger(selectedIndex) ||
        selectedIndex < 1 ||
        selectedIndex > session.emoteCandidates.length
      ) {
        await sendThreadText(
          client,
          roomId,
          session.threadRootEventId,
          userId,
          textMessage(`Please reply with a number between 1 and ${session.emoteCandidates.length}, or "cancel".`)
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
        await sendThreadText(
          client,
          roomId,
          session.threadRootEventId,
          userId,
          textMessage('Please reply with a number from the pack list, or "cancel".')
        );
        return;
      }

      const selectedOption = options.find((option) => option.number === selectedOptionNumber);
      if (!selectedOption) {
        await sendThreadText(
          client,
          roomId,
          session.threadRootEventId,
          userId,
          textMessage('Please reply with a number from the pack list, or "cancel".')
        );
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

        await sendThreadText(
          client,
          roomId,
          session.threadRootEventId,
          userId,
          {
            plain: `Name for the new ${selectedOption.action.scope} pack in ${selectedOption.action.roomDisplayName}?`,
            html: `Name for the new <b>${escapeHtml(selectedOption.action.scope)}</b> pack in <b>${escapeHtml(selectedOption.action.roomDisplayName)}</b>?`,
          }
        );
        return;
      }

      const selectedPack = existingChoices[selectedOption.action.packChoiceIndex];
      if (!selectedPack) {
        await sendThreadText(
          client,
          roomId,
          session.threadRootEventId,
          userId,
          textMessage("Selected pack is no longer available. Please choose again.")
        );
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
      await sendThreadText(
        client,
        roomId,
        session.threadRootEventId,
        userId,
        {
          plain: [
            `Pack: ${selectedPack.displayName} (${selectedPack.scope === "space" ? "space" : "room"})`,
            `Name for emote (default: ${selectedEmoteName}). Reply with a name or "ok" to use default.`,
          ].join("\n"),
          html: [
            `<b>Pack:</b> ${escapeHtml(selectedPack.displayName)} <i>(${selectedPack.scope === "space" ? "space" : "room"})</i>`,
            `Name for emote (default: <b>${escapeHtml(selectedEmoteName)}</b>). Reply with a name or <code>ok</code> to use default.`,
          ].join("<br>"),
        }
      );
      return;
    }

    if (session.step === "confirm_pack_name") {
      const rawName = trimmed;
      if (!rawName) {
        await sendThreadText(
          client,
          roomId,
          session.threadRootEventId,
          userId,
          textMessage("Pack name cannot be empty. Reply with a valid pack name or cancel.")
        );
        return;
      }

      if (Buffer.byteLength(rawName, "utf8") > 80) {
        await sendThreadText(
          client,
          roomId,
          session.threadRootEventId,
          userId,
          textMessage("Pack name is too long. Please keep it under 80 bytes.")
        );
        return;
      }

      const newPackRoomId = session.newPackRoomId;
      const newPackScope = session.newPackScope;
      const newPackRoomDisplayName = session.newPackRoomDisplayName;
      if (!newPackRoomId || !newPackScope || !newPackRoomDisplayName) {
        selectionManager.clearSession(userId, roomId);
        await sendThreadText(
          client,
          roomId,
          session.threadRootEventId,
          userId,
          textMessage("Selection expired or invalid. Please run /add-emote again.")
        );
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
      await sendThreadText(
        client,
        roomId,
        session.threadRootEventId,
        userId,
        {
          plain: [
            `Created pack target: ${rawName} (${newPackScope})`,
            `Name for emote (default: ${selectedEmoteName}). Reply with a name or "ok" to use default.`,
          ].join("\n"),
          html: [
            `Created pack target: <b>${escapeHtml(rawName)}</b> <i>(${escapeHtml(newPackScope)})</i>`,
            `Name for emote (default: <b>${escapeHtml(selectedEmoteName)}</b>). Reply with a name or <code>ok</code> to use default.`,
          ].join("<br>"),
        }
      );
      return;
    }

    if (session.step === "confirm_name") {
      const selectedIndex = session.selectedEmoteIndex ?? 0;
      const selectedEmote = session.emoteCandidates[selectedIndex];
      const defaultName = selectedEmote?.name || "emote";
      const finalName = trimmed.toLowerCase() === "ok" ? defaultName : trimmed;

      if (!finalName) {
        await sendThreadText(
          client,
          roomId,
          session.threadRootEventId,
          userId,
          textMessage("Name cannot be empty. Reply with a valid name or \"ok\".")
        );
        return;
      }

      if (!isValidEmoteName(finalName)) {
        await sendThreadText(
          client,
          roomId,
          session.threadRootEventId,
          userId,
          textMessage("Invalid emote name. Use only letters, numbers, '-' or '_', max 100 bytes.")
        );
        return;
      }

      if (!selectedEmote) {
        selectionManager.clearSession(userId, roomId);
        await sendThreadText(
          client,
          roomId,
          session.threadRootEventId,
          userId,
          textMessage("Selection expired or invalid. Please run /add-emote again.")
        );
        return;
      }

      const packChoices = session.packChoices ?? [];
      const selectedPackIndex = session.selectedPackChoiceIndex ?? -1;
      const selectedPack = packChoices[selectedPackIndex];
      if (!selectedPack) {
        selectionManager.clearSession(userId, roomId);
        await sendThreadText(
          client,
          roomId,
          session.threadRootEventId,
          userId,
          textMessage("Pack selection expired. Please run /add-emote again.")
        );
        return;
      }

      const shortcodeExists = await emotePackService.roomPackHasShortcode(
        selectedPack.roomId,
        finalName,
        selectedPack.stateKey
      );
      if (shortcodeExists) {
        await sendThreadText(
          client,
          roomId,
          session.threadRootEventId,
          userId,
          textMessage(`:${finalName}: already exists in ${selectedPack.displayName}. Reply with a different name or "cancel".`)
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
          await sendThreadText(
            client,
            roomId,
            session.threadRootEventId,
            userId,
            {
              plain: `Added :${finalName}: to space pack "${selectedPack.displayName}" in ${selectedPack.roomDisplayName}.`,
              html: `Added <b>:${escapeHtml(finalName)}:</b> to space pack <b>"${escapeHtml(selectedPack.displayName)}"</b> in <b>${escapeHtml(selectedPack.roomDisplayName)}</b>.`,
            },
            true
          );
        } else {
          await sendThreadText(
            client,
            roomId,
            session.threadRootEventId,
            userId,
            {
              plain: `Added :${finalName}: to room pack "${selectedPack.displayName}".`,
              html: `Added <b>:${escapeHtml(finalName)}:</b> to room pack <b>"${escapeHtml(selectedPack.displayName)}"</b>.`,
            },
            true
          );
        }
      } catch (error) {
        LogService.error("add-emote", "Failed to upload/add emote", error);
        await sendThreadText(
          client,
          roomId,
          session.threadRootEventId,
          userId,
          textMessage(getAddEmoteErrorMessage(error)),
          true
        );
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
  threadRootEventId: string,
  userId: string,
  query: string,
  emoteCandidates: Array<{ id: string; name: string; animated: boolean; webpUrl: string }>
): Promise<void> {
  await sendThreadText(
    client,
    roomId,
    threadRootEventId,
    userId,
    {
      plain: `Found ${emoteCandidates.length} emotes for "${query}". Sending previews...`,
      html: `Found <b>${emoteCandidates.length}</b> emotes for <b>"${escapeHtml(query)}"</b>. Sending previews...`,
    },
    true
  );

  for (const [idx, emote] of emoteCandidates.entries()) {
    try {
      const previewMxc = await mediaUploadService.uploadFromUrl(emote.webpUrl);
      await sendThreadImage(
        client,
        roomId,
        threadRootEventId,
        `${idx + 1}. ${emote.name}${emote.animated ? " (animated)" : ""}`,
        previewMxc
      );
    } catch (error) {
      LogService.warn("add-emote", `Preview upload failed for ${emote.id}`, error as Error);
      await sendThreadText(
        client,
        roomId,
        threadRootEventId,
        userId,
        textMessage(`${idx + 1}. ${emote.name}${emote.animated ? " (animated)" : ""} - ${emote.webpUrl}`)
      );
    }
  }

  await sendThreadText(
    client,
    roomId,
    threadRootEventId,
    userId,
    {
      plain: 'Reply with a number to select, or "cancel".',
      html: 'Reply with a number to select, or <code>cancel</code>.',
    }
  );
}

async function sendDirectSelectionPreview(
  client: BotClient,
  mediaUploadService: MediaUploadService,
  roomId: string,
  threadRootEventId: string,
  userId: string,
  selectedEmote: { id: string; name: string; animated: boolean; webpUrl: string }
): Promise<void> {
  await sendThreadText(
    client,
    roomId,
    threadRootEventId,
    userId,
    {
      plain: `Selected by link: ${selectedEmote.name}. Sending preview...`,
      html: `Selected by link: <b>${escapeHtml(selectedEmote.name)}</b>. Sending preview...`,
    },
    true
  );

  try {
    const previewMxc = await mediaUploadService.uploadFromUrl(selectedEmote.webpUrl);
    await sendThreadImage(
      client,
      roomId,
      threadRootEventId,
      `${selectedEmote.name}${selectedEmote.animated ? " (animated)" : ""}`,
      previewMxc
    );
  } catch (error) {
    LogService.warn("add-emote", `Preview upload failed for ${selectedEmote.id}`, error as Error);
    await sendThreadText(
      client,
      roomId,
      threadRootEventId,
      userId,
      textMessage(`${selectedEmote.name}${selectedEmote.animated ? " (animated)" : ""} - ${selectedEmote.webpUrl}`)
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
): FormattedMessage {
  const plainLines: string[] = [
    `Selected: ${selectedEmoteName}`,
    "Add to which pack?",
  ];
  const htmlLines: string[] = [
    `Selected: <b>${escapeHtml(selectedEmoteName)}</b>`,
    "Add to which pack?",
  ];

  for (const option of options) {
    if (option.action.kind === "existing") {
      const pack = packChoices[option.action.packChoiceIndex];
      if (pack) {
        const scopeLabel = pack.scope === "space" ? `space: ${pack.roomDisplayName}` : "this room";
        const keyLabel = pack.stateKey ? ` [${pack.stateKey}]` : " [default]";
        plainLines.push(`  ${option.number}. ${pack.displayName} (${scopeLabel})${keyLabel}`);
        htmlLines.push(
          `&nbsp;&nbsp;${option.number}. <b>${escapeHtml(pack.displayName)}</b> <i>(${escapeHtml(scopeLabel)})</i>${escapeHtml(keyLabel)}`
        );
      }
      continue;
    }

    const targetLabel = option.action.scope === "space"
      ? `Create new pack in space ${option.action.roomDisplayName}`
      : "Create new pack in this room";
    plainLines.push(`  ${option.number}. ${targetLabel}`);
    htmlLines.push(`&nbsp;&nbsp;${option.number}. ${escapeHtml(targetLabel)}`);
  }

  plainLines.push('Reply with a number, or "cancel".');
  htmlLines.push('Reply with a number, or <code>cancel</code>.');
  return {
    plain: plainLines.join("\n"),
    html: htmlLines.join("<br>"),
  };
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
    await sendThreadText(
      client,
      roomId,
      session.threadRootEventId,
      userId,
      textMessage(
        "I cannot edit room or canonical-space emote packs from here. Ask an admin to grant me state-event rights for im.ponies.room_emotes."
      ),
      true
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

  await sendThreadText(
    client,
    roomId,
    session.threadRootEventId,
    userId,
    formatPackSelectionMessage(selectedEmoteName, packChoices, options)
  );
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
