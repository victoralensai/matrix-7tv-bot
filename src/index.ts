import { loadConfig } from "./config";
import { createBot } from "./bot";
import { LogService } from "matrix-bot-sdk";
import * as fs from "fs";
import { SelectionManager } from "./session/selectionManager";
import { isValidEmoteName, parseAddEmoteCommand } from "./commands/addEmote";
import { getHelpMessage } from "./commands/help";
import { SevenTvService } from "./services/sevenTv";
import { EmotePackService } from "./services/emotePack";
import { MediaUploadService } from "./services/mediaUpload";

async function main() {
  const config = loadConfig();
  const selectionManager = new SelectionManager(config.selectionTimeoutMs);
  const sevenTv = new SevenTvService();

  // Ensure data directory exists
  if (!fs.existsSync(config.dataPath)) {
    fs.mkdirSync(config.dataPath, { recursive: true });
  }

  LogService.info("index", "Starting Matrix 7TV Bot...");
  LogService.info("index", `Homeserver: ${config.homeserverUrl}`);
  LogService.info("index", `Bot User ID: ${config.botUserId}`);

  const client = await createBot(config);
  const emotePackService = new EmotePackService(client);
  const mediaUploadService = new MediaUploadService(client);

  setInterval(() => {
    const removed = selectionManager.cleanupExpiredSessions();
    if (removed > 0) {
      LogService.info("session", `Cleaned up ${removed} expired session(s)`);
    }
  }, Math.max(5000, Math.floor(config.selectionTimeoutMs / 2)));

  // Command and selection message handling
  client.on("room.message", async (roomId: string, event: any) => {
    // Ignore messages from the bot itself
    if (event.sender === config.botUserId) return;

    // Ignore non-text messages
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

    const addEmoteCommand = parseAddEmoteCommand(trimmed);
    if (addEmoteCommand) {
      let results;
      try {
        results = await sevenTv.searchEmotes(addEmoteCommand.query, 5);
      } catch (error) {
        LogService.error("7tv", "Search failed", error);
        await client.sendText(
          roomId,
          "7TV search failed. Please try again later."
        );
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

      const selectedEmote = session.emoteCandidates[selectedIndex - 1];
      selectionManager.updateSession(userId, roomId, {
        step: "pick_pack",
        selectedEmoteIndex: selectedIndex - 1,
      });

      await client.sendText(
        roomId,
        [
          `Selected: ${selectedEmote?.name || "unknown"}`,
          "Add to:",
          "  1. This room's pack",
          "  2. Your personal pack",
          'Reply with 1 or 2, or "cancel".',
        ].join("\n")
      );
      return;
    }

    if (session.step === "pick_pack") {
      if (trimmed !== "1" && trimmed !== "2") {
        await client.sendText(roomId, 'Please reply with 1 or 2, or "cancel".');
        return;
      }

      if (trimmed === "1") {
        const canEdit = await emotePackService.canUserEditRoomPack(userId, roomId);
        if (!canEdit) {
          await client.sendText(
            roomId,
            "You do not have permission to add emotes to this room pack. Choose 2 for your personal pack, or cancel."
          );
          return;
        }
      }

      const selectedIndex = session.selectedEmoteIndex ?? 0;
      const selectedEmoteName = session.emoteCandidates[selectedIndex]?.name || "unknown";
      selectionManager.updateSession(userId, roomId, {
        step: "confirm_name",
        packTarget: trimmed === "1" ? "room" : "personal",
      });

      await client.sendText(
        roomId,
        `Name for emote (default: ${selectedEmoteName}). Reply with a name or "ok" to use default.`
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

      const packTarget = session.packTarget === "room" ? "room" : "personal";
      const shortcodeExists =
        packTarget === "room"
          ? await emotePackService.roomPackHasShortcode(roomId, finalName)
          : await emotePackService.personalPackHasShortcode(finalName);
      if (shortcodeExists) {
        await client.sendText(
          roomId,
          `:${finalName}: already exists in your ${packTarget} pack. Reply with a different name or "cancel".`
        );
        return;
      }

      try {
        const webpData = await sevenTv.downloadFromUrl(selectedEmote.webpUrl);

        const filename = `${finalName}.webp`;
        const mxcUrl = await mediaUploadService.uploadWebp(webpData, filename);

        if (session.packTarget === "room") {
          await emotePackService.addToRoomPack(roomId, finalName, {
            url: mxcUrl,
            body: finalName,
            info: {
              mimetype: "image/webp",
              size: webpData.length,
            },
          });
          await client.sendText(roomId, `Added :${finalName}: to this room's emote pack.`);
        } else {
          await emotePackService.addToPersonalPack(finalName, {
            url: mxcUrl,
            body: finalName,
            info: {
              mimetype: "image/webp",
              size: webpData.length,
            },
          });
          await client.sendText(roomId, `Added :${finalName}: to your personal emote pack.`);
        }
      } catch (error) {
        LogService.error("add-emote", "Failed to upload/add emote", error);
        await client.sendText(roomId, getAddEmoteErrorMessage(error));
      }

      selectionManager.clearSession(userId, roomId);
      return;
    }
  });

  // Start syncing
  await client.start();
  LogService.info("index", "Bot started successfully!");
}

async function sendSearchResultsWithPreviews(
  client: Awaited<ReturnType<typeof createBot>>,
  mediaUploadService: MediaUploadService,
  roomId: string,
  query: string,
  emoteCandidates: Array<{ id: string; name: string; animated: boolean; webpUrl: string }>
): Promise<void> {
  await client.sendText(
    roomId,
    [
      `Found ${emoteCandidates.length} emotes for "${query}":`,
      "Sending previews...",
    ].join("\n")
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

function getAddEmoteErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unknown error";
  if (message.includes("7TV") || message.includes("cdn.7tv.app")) {
    return "Failed to download the selected emote from 7TV. Please try another result or retry later.";
  }

  if (message.includes("M_FORBIDDEN") || message.toLowerCase().includes("forbidden")) {
    return "Matrix rejected the update (permission denied). Please verify bot/user permissions and try again.";
  }

  return "Failed to add emote due to an unexpected error. Please try again.";
}

main().catch((err) => {
  LogService.error("index", "Fatal error:", err);
  process.exit(1);
});
