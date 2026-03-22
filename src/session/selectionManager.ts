export type SelectionStep = "pick_emote" | "pick_pack" | "confirm_pack_name" | "confirm_name";

export type PackScope = "room" | "space";

export interface PackChoice {
  scope: PackScope;
  roomId: string;
  roomDisplayName: string;
  stateKey: string;
  displayName: string;
}

export interface EmoteCandidate {
  id: string;
  name: string;
  animated: boolean;
  webpUrl: string;
}

export interface EmoteSelectionSession {
  userId: string;
  roomId: string;
  step: SelectionStep;
  query: string;
  emoteCandidates: EmoteCandidate[];
  selectedEmoteIndex?: number;
  packChoices?: PackChoice[];
  selectedPackChoiceIndex?: number;
  newPackScope?: PackScope;
  newPackRoomId?: string;
  newPackRoomDisplayName?: string;
  customName?: string;
  createdAtMs: number;
  expiresAtMs: number;
}

export class SelectionManager {
  private readonly sessions = new Map<string, EmoteSelectionSession>();

  public constructor(private readonly timeoutMs: number) {}

  public startEmoteSelection(
    userId: string,
    roomId: string,
    query: string,
    emoteCandidates: EmoteCandidate[],
    options?: {
      preselectedEmoteIndex?: number;
    }
  ): EmoteSelectionSession {
    const now = Date.now();
    const hasPreselected =
      typeof options?.preselectedEmoteIndex === "number" &&
      options.preselectedEmoteIndex >= 0 &&
      options.preselectedEmoteIndex < emoteCandidates.length;
    const session: EmoteSelectionSession = {
      userId,
      roomId,
      step: hasPreselected ? "pick_pack" : "pick_emote",
      query,
      emoteCandidates,
      selectedEmoteIndex: hasPreselected ? options?.preselectedEmoteIndex : undefined,
      createdAtMs: now,
      expiresAtMs: now + this.timeoutMs,
    };

    this.sessions.set(this.makeKey(userId, roomId), session);
    return session;
  }

  public getSession(userId: string, roomId: string): EmoteSelectionSession | null {
    const key = this.makeKey(userId, roomId);
    const session = this.sessions.get(key);
    if (!session) return null;

    if (Date.now() > session.expiresAtMs) {
      this.sessions.delete(key);
      return null;
    }

    return session;
  }

  public updateSession(
    userId: string,
    roomId: string,
    updates: Partial<Omit<EmoteSelectionSession, "userId" | "roomId" | "createdAtMs">>
  ): EmoteSelectionSession | null {
    const session = this.getSession(userId, roomId);
    if (!session) return null;

    const updated: EmoteSelectionSession = {
      ...session,
      ...updates,
      expiresAtMs: Date.now() + this.timeoutMs,
    };

    this.sessions.set(this.makeKey(userId, roomId), updated);
    return updated;
  }

  public clearSession(userId: string, roomId: string): boolean {
    return this.sessions.delete(this.makeKey(userId, roomId));
  }

  public cleanupExpiredSessions(): number {
    const now = Date.now();
    let removed = 0;

    for (const [key, session] of this.sessions.entries()) {
      if (now > session.expiresAtMs) {
        this.sessions.delete(key);
        removed += 1;
      }
    }

    return removed;
  }

  private makeKey(userId: string, roomId: string): string {
    return `${userId}|${roomId}`;
  }
}
