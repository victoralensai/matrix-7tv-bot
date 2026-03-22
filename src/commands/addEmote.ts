export interface ParsedAddEmoteCommand {
  query: string;
}

const EMOTE_NAME_REGEX = /^[a-zA-Z0-9-_]+$/;

export function parseAddEmoteCommand(messageBody: string): ParsedAddEmoteCommand | null {
  const trimmed = messageBody.trim();
  if (!trimmed.startsWith("/add-emote")) {
    return null;
  }

  const nextChar = trimmed.charAt("/add-emote".length);
  if (nextChar && !/\s/.test(nextChar)) {
    return null;
  }

  const rest = trimmed.slice("/add-emote".length).trim();
  if (!rest) {
    return null;
  }

  return { query: rest };
}

export function isValidEmoteName(name: string): boolean {
  if (!name) return false;
  if (!EMOTE_NAME_REGEX.test(name)) return false;
  return Buffer.byteLength(name, "utf8") <= 100;
}
