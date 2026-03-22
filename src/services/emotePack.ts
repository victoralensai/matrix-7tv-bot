import { MatrixClient } from "matrix-bot-sdk";

export interface EmoteImageEntry {
  url: string;
  body?: string;
  info?: {
    mimetype?: string;
    size?: number;
    w?: number;
    h?: number;
  };
}

export interface EmotePackContent {
  images: Record<string, EmoteImageEntry>;
  pack?: {
    display_name?: string;
    usage?: string[];
    attribution?: string;
  };
}

export interface RoomPackDescriptor {
  roomId: string;
  roomDisplayName: string;
  stateKey: string;
  displayName: string;
}

const ROOM_EMOTES_EVENT = "im.ponies.room_emotes";
const ROOM_PARENT_EVENT = "m.space.parent";

interface RoomStateEvent {
  type?: string;
  state_key?: string;
  content?: unknown;
}

interface RoomNameState {
  name?: string;
}

interface ParentStateContent {
  canonical?: boolean;
}

export class EmotePackService {
  public constructor(private readonly client: MatrixClient) {}

  public async canUserEditRoomPack(userId: string, roomId: string): Promise<boolean> {
    return this.client.userHasPowerLevelFor(userId, roomId, ROOM_EMOTES_EVENT, true);
  }

  public async getEditablePackTargets(
    userId: string,
    roomId: string
  ): Promise<{ roomPacks: RoomPackDescriptor[]; spacePacks: RoomPackDescriptor[]; canonicalSpaceId: string | null }> {
    const roomPacks = await this.listRoomPacks(roomId);
    const canonicalSpaceId = await this.getCanonicalParentSpaceId(roomId);

    let spacePacks: RoomPackDescriptor[] = [];
    if (canonicalSpaceId) {
      const canEditSpace = await this.canUserEditRoomPack(userId, canonicalSpaceId);
      if (canEditSpace) {
        spacePacks = await this.listRoomPacks(canonicalSpaceId);
      }
    }

    return {
      roomPacks,
      spacePacks,
      canonicalSpaceId,
    };
  }

  public async listRoomPacks(roomId: string): Promise<RoomPackDescriptor[]> {
    const stateEvents = await this.client.getRoomState(roomId);
    const roomName = await this.getRoomDisplayName(roomId, stateEvents);

    const descriptors = stateEvents
      .filter((event) => event?.type === ROOM_EMOTES_EVENT)
      .map((event) => {
        const stateKey = typeof event.state_key === "string" ? event.state_key : "";
        const content = this.normalizePackContent(event.content);
        const displayName = content.pack?.display_name || (stateKey ? `Pack ${stateKey}` : "Default Pack");
        return {
          roomId,
          roomDisplayName: roomName,
          stateKey,
          displayName,
        };
      });

    if (descriptors.length > 0) {
      return descriptors.sort((a, b) => {
        if (a.stateKey === "" && b.stateKey !== "") return -1;
        if (a.stateKey !== "" && b.stateKey === "") return 1;
        return a.displayName.localeCompare(b.displayName);
      });
    }

    return [
      {
        roomId,
        roomDisplayName: roomName,
        stateKey: "",
        displayName: "Default Pack",
      },
    ];
  }

  public async getCanonicalParentSpaceId(roomId: string): Promise<string | null> {
    const stateEvents = await this.client.getRoomState(roomId);
    for (const event of stateEvents) {
      if (event?.type !== ROOM_PARENT_EVENT) {
        continue;
      }

      const content = (event.content ?? {}) as ParentStateContent;
      if (!content.canonical) {
        continue;
      }

      const stateKey = typeof event.state_key === "string" ? event.state_key : "";
      if (!stateKey) {
        continue;
      }

      try {
        const roomState = await this.client.getRoomStateEvent(stateKey, "m.room.create", "");
        const createType = (roomState ?? {}) as { type?: string };
        if (createType.type === "m.space") {
          return stateKey;
        }
      } catch {
        continue;
      }
    }

    return null;
  }

  public async addToRoomPack(
    roomId: string,
    shortcode: string,
    image: EmoteImageEntry,
    options?: { packDisplayName?: string; stateKey?: string }
  ): Promise<void> {
    const stateKey = options?.stateKey ?? "";
    const content = await this.getRoomPack(roomId, stateKey);
    content.images[shortcode] = image;

    if (!content.pack) {
      content.pack = {
        display_name: options?.packDisplayName ?? "Room Emotes",
        usage: ["emoticon", "sticker"],
      };
    }

    await this.client.sendStateEvent(roomId, ROOM_EMOTES_EVENT, stateKey, content);
  }

  public async createRoomPack(roomId: string, stateKey: string, displayName: string): Promise<void> {
    const content = await this.getRoomPack(roomId, stateKey);
    if (!content.pack) {
      content.pack = {
        display_name: displayName,
        usage: ["emoticon", "sticker"],
      };
    }

    await this.client.sendStateEvent(roomId, ROOM_EMOTES_EVENT, stateKey, content);
  }

  public async roomPackHasShortcode(roomId: string, shortcode: string, stateKey = ""): Promise<boolean> {
    const content = await this.getRoomPack(roomId, stateKey);
    return Object.prototype.hasOwnProperty.call(content.images, shortcode);
  }

  private async getRoomPack(roomId: string, stateKey = ""): Promise<EmotePackContent> {
    try {
      const existing = await this.client.getRoomStateEvent(roomId, ROOM_EMOTES_EVENT, stateKey);
      return this.normalizePackContent(existing);
    } catch {
      return { images: {} };
    }
  }

  private async getRoomDisplayName(roomId: string, stateEvents?: RoomStateEvent[]): Promise<string> {
    const fromCache = (stateEvents ?? []).find(
      (event) => event?.type === "m.room.name" && event?.state_key === ""
    );
    if (fromCache) {
      const name = ((fromCache.content ?? {}) as RoomNameState).name;
      if (name && typeof name === "string") {
        return name;
      }
    }

    try {
      const existing = await this.client.getRoomStateEvent(roomId, "m.room.name", "");
      const name = ((existing ?? {}) as RoomNameState).name;
      if (name && typeof name === "string") {
        return name;
      }
    } catch {
      return roomId;
    }

    return roomId;
  }

  private normalizePackContent(value: unknown): EmotePackContent {
    const content = (value ?? {}) as Partial<EmotePackContent>;
    return {
      images: content.images ?? {},
      pack: content.pack,
    };
  }
}
