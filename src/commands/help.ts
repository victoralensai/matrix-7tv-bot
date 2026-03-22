export function getHelpMessage(): string {
  return [
    "Matrix 7TV Bot Commands:",
    "  /add-emote <search> - Search for an emote on 7TV and begin selection flow",
    "  /add-emote-by-link <7tv link> - Add a specific 7TV emote by link",
    "  /cancel - Cancel your current selection flow",
    "  /help - Show this help message",
  ].join("\n");
}
