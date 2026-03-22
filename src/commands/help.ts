export function getHelpMessage(): string {
  return [
    "Matrix 7TV Bot Commands:",
    "  /add-emote <search> - Search for an emote on 7TV and begin selection flow",
    "  /add-emote-by-link <7tv link> - Add a specific 7TV emote by link",
    "  /cancel - Cancel your current selection flow",
    "  /help - Show this help message",
  ].join("\n");
}

export function getHelpHtmlMessage(): string {
  return [
    "<b>Matrix 7TV Bot Commands</b>",
    "<br>",
    "<code>/add-emote &lt;search&gt;</code> - Search for an emote on 7TV and begin selection flow",
    "<br>",
    "<code>/add-emote-by-link &lt;7tv link&gt;</code> - Add a specific 7TV emote by link",
    "<br>",
    "<code>/cancel</code> - Cancel your current selection flow",
    "<br>",
    "<code>/help</code> - Show this help message",
  ].join("");
}
