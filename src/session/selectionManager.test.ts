import { describe, expect, it } from "vitest";
import { SelectionManager } from "./selectionManager";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

describe("SelectionManager", () => {
  it("starts and gets a session", () => {
    const manager = new SelectionManager(1000);
    manager.startEmoteSelection("@alice:example.com", "!room:example.com", "pepe", [
      { id: "1", name: "Pepega", animated: false, webpUrl: "https://cdn.7tv.app/emote/1/4x.webp" },
    ]);

    const session = manager.getSession("@alice:example.com", "!room:example.com");
    expect(session).not.toBeNull();
    expect(session?.query).toBe("pepe");
    expect(session?.step).toBe("pick_emote");
    expect(session?.emoteCandidates).toHaveLength(1);
  });

  it("updates session and advances step", () => {
    const manager = new SelectionManager(1000);
    manager.startEmoteSelection("@alice:example.com", "!room:example.com", "pepe", [
      { id: "1", name: "Pepega", animated: false, webpUrl: "https://cdn.7tv.app/emote/1/4x.webp" },
    ]);

    const updated = manager.updateSession("@alice:example.com", "!room:example.com", {
      step: "pick_pack",
      selectedEmoteIndex: 2,
    });

    expect(updated).not.toBeNull();
    expect(updated?.step).toBe("pick_pack");
    expect(updated?.selectedEmoteIndex).toBe(2);
  });

  it("clears session", () => {
    const manager = new SelectionManager(1000);
    manager.startEmoteSelection("@alice:example.com", "!room:example.com", "pepe", [
      { id: "1", name: "Pepega", animated: false, webpUrl: "https://cdn.7tv.app/emote/1/4x.webp" },
    ]);

    expect(manager.clearSession("@alice:example.com", "!room:example.com")).toBe(true);
    expect(manager.getSession("@alice:example.com", "!room:example.com")).toBeNull();
  });

  it("expires sessions and removes them", async () => {
    const manager = new SelectionManager(20);
    manager.startEmoteSelection("@alice:example.com", "!room:example.com", "pepe", [
      { id: "1", name: "Pepega", animated: false, webpUrl: "https://cdn.7tv.app/emote/1/4x.webp" },
    ]);

    await sleep(30);

    expect(manager.getSession("@alice:example.com", "!room:example.com")).toBeNull();
  });

  it("cleanupExpiredSessions returns removed count", async () => {
    const manager = new SelectionManager(20);
    manager.startEmoteSelection("@alice:example.com", "!room:example.com", "pepe", [
      { id: "1", name: "Pepega", animated: false, webpUrl: "https://cdn.7tv.app/emote/1/4x.webp" },
    ]);
    manager.startEmoteSelection("@bob:example.com", "!room:example.com", "kekw", [
      { id: "2", name: "KEKW", animated: true, webpUrl: "https://cdn.7tv.app/emote/2/4x.webp" },
    ]);

    await sleep(30);

    expect(manager.cleanupExpiredSessions()).toBe(2);
  });
});
