import { describe, expect, it } from "vitest";
import { parse7TvEmoteIdFromInput, parseAddEmoteByLinkCommand } from "./addEmoteByLink";

describe("parse7TvEmoteIdFromInput", () => {
  it("parses a full 7tv app URL", () => {
    expect(parse7TvEmoteIdFromInput("https://7tv.app/emotes/01EZTD6KQ800012PTN006Q50PV")).toBe(
      "01EZTD6KQ800012PTN006Q50PV"
    );
  });

  it("parses a host-only URL without scheme", () => {
    expect(parse7TvEmoteIdFromInput("7tv.app/emotes/01EZTD6KQ800012PTN006Q50PV")).toBe(
      "01EZTD6KQ800012PTN006Q50PV"
    );
  });

  it("accepts a raw emote id", () => {
    expect(parse7TvEmoteIdFromInput("01EZTD6KQ800012PTN006Q50PV")).toBe(
      "01EZTD6KQ800012PTN006Q50PV"
    );
  });

  it("rejects non-7tv URLs", () => {
    expect(parse7TvEmoteIdFromInput("https://example.com/emotes/01EZTD6KQ800012PTN006Q50PV")).toBeNull();
  });
});

describe("parseAddEmoteByLinkCommand", () => {
  it("parses a valid command", () => {
    expect(parseAddEmoteByLinkCommand("/add-emote-by-link https://7tv.app/emotes/01EZTD6KQ800012PTN006Q50PV")).toEqual({
      emoteId: "01EZTD6KQ800012PTN006Q50PV",
      originalLink: "https://7tv.app/emotes/01EZTD6KQ800012PTN006Q50PV",
    });
  });

  it("returns null for missing link", () => {
    expect(parseAddEmoteByLinkCommand("/add-emote-by-link")).toBeNull();
  });

  it("returns null for invalid command", () => {
    expect(parseAddEmoteByLinkCommand("/add-emote-by-linkx https://7tv.app/emotes/01EZTD6KQ800012PTN006Q50PV")).toBeNull();
  });
});
