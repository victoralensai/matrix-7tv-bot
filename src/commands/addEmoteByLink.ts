const ADD_EMOTE_BY_LINK_PREFIX = "/add-emote-by-link";
const VALID_7TV_HOSTS = new Set(["7tv.app", "www.7tv.app", "7tv.io", "www.7tv.io"]);

export interface ParsedAddEmoteByLinkCommand {
  emoteId: string;
  originalLink: string;
}

export function parseAddEmoteByLinkCommand(messageBody: string): ParsedAddEmoteByLinkCommand | null {
  const trimmed = messageBody.trim();
  if (!trimmed.startsWith(ADD_EMOTE_BY_LINK_PREFIX)) {
    return null;
  }

  const nextChar = trimmed.charAt(ADD_EMOTE_BY_LINK_PREFIX.length);
  if (nextChar && !/\s/.test(nextChar)) {
    return null;
  }

  const rest = trimmed.slice(ADD_EMOTE_BY_LINK_PREFIX.length).trim();
  if (!rest) {
    return null;
  }

  const emoteId = parse7TvEmoteIdFromInput(rest);
  if (!emoteId) {
    return null;
  }

  return {
    emoteId,
    originalLink: rest,
  };
}

export function parse7TvEmoteIdFromInput(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  if (isLikely7TvEmoteId(trimmed)) {
    return trimmed;
  }

  const candidates = trimmed.startsWith("http://") || trimmed.startsWith("https://")
    ? [trimmed]
    : [`https://${trimmed}`];

  for (const candidate of candidates) {
    const id = parse7TvEmoteIdFromUrl(candidate);
    if (id) {
      return id;
    }
  }

  return null;
}

function parse7TvEmoteIdFromUrl(urlValue: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(urlValue);
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  if (!VALID_7TV_HOSTS.has(host)) {
    return null;
  }

  const parts = parsed.pathname.split("/").filter(Boolean);
  if (parts.length < 2 || parts[0] !== "emotes") {
    return null;
  }

  const emoteId = parts[1] || "";
  if (!isLikely7TvEmoteId(emoteId)) {
    return null;
  }

  return emoteId;
}

function isLikely7TvEmoteId(value: string): boolean {
  return /^[0-9A-Za-z]{24,32}$/.test(value);
}
