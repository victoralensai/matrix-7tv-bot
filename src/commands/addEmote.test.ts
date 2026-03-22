import { describe, expect, it } from "vitest";
import { isValidEmoteName, parseAddEmoteCommand } from "./addEmote";

describe("parseAddEmoteCommand", () => {
  it("parses a valid add-emote command", () => {
    expect(parseAddEmoteCommand("/add-emote pepeLaugh")).toEqual({ query: "pepeLaugh" });
  });

  it("trims outer whitespace", () => {
    expect(parseAddEmoteCommand("   /add-emote   pepe  ")).toEqual({ query: "pepe" });
  });

  it("returns null when query is missing", () => {
    expect(parseAddEmoteCommand("/add-emote")).toBeNull();
    expect(parseAddEmoteCommand("/add-emote     ")).toBeNull();
  });

  it("returns null for non add-emote command", () => {
    expect(parseAddEmoteCommand("/help")).toBeNull();
    expect(parseAddEmoteCommand("hello world")).toBeNull();
    expect(parseAddEmoteCommand("/add-emotex pepe")).toBeNull();
  });
});

describe("isValidEmoteName", () => {
  it("accepts valid shortcode names", () => {
    expect(isValidEmoteName("Pepega")).toBe(true);
    expect(isValidEmoteName("pepe_laugh")).toBe(true);
    expect(isValidEmoteName("pepe-laugh-2")).toBe(true);
  });

  it("rejects invalid shortcode names", () => {
    expect(isValidEmoteName("")).toBe(false);
    expect(isValidEmoteName("contains space")).toBe(false);
    expect(isValidEmoteName("emoji🔥")).toBe(false);
    expect(isValidEmoteName("slash/name")).toBe(false);
  });

  it("enforces 100-byte limit", () => {
    expect(isValidEmoteName("a".repeat(100))).toBe(true);
    expect(isValidEmoteName("a".repeat(101))).toBe(false);
  });
});
