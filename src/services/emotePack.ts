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

const ROOM_EMOTES_EVENT = "im.ponies.room_emotes";
const USER_EMOTES_EVENT = "im.ponies.user_emotes";

export class EmotePackService {
  public constructor(private readonly client: MatrixClient) {}

  public async canUserEditRoomPack(userId: string, roomId: string): Promise<boolean> {
    return this.client.userHasPowerLevelFor(userId, roomId, ROOM_EMOTES_EVENT, true);
  }

  public async addToRoomPack(
    roomId: string,
    shortcode: string,
    image: EmoteImageEntry,
    packDisplayName = "Room Emotes"
  ): Promise<void> {
    const content = await this.getRoomPack(roomId);
    content.images[shortcode] = image;

    if (!content.pack) {
      content.pack = {
        display_name: packDisplayName,
        usage: ["emoticon", "sticker"],
      };
    }

    await this.client.sendStateEvent(roomId, ROOM_EMOTES_EVENT, "", content);
  }

  public async addToPersonalPack(
    shortcode: string,
    image: EmoteImageEntry,
    packDisplayName = "Personal Emotes"
  ): Promise<void> {
    const content = await this.getPersonalPack();
    content.images[shortcode] = image;

    if (!content.pack) {
      content.pack = {
        display_name: packDisplayName,
        usage: ["emoticon", "sticker"],
      };
    }

    await this.client.setAccountData(USER_EMOTES_EVENT, content);
  }

  public async roomPackHasShortcode(roomId: string, shortcode: string): Promise<boolean> {
    const content = await this.getRoomPack(roomId);
    return Object.prototype.hasOwnProperty.call(content.images, shortcode);
  }

  public async personalPackHasShortcode(shortcode: string): Promise<boolean> {
    const content = await this.getPersonalPack();
    return Object.prototype.hasOwnProperty.call(content.images, shortcode);
  }

  private async getRoomPack(roomId: string): Promise<EmotePackContent> {
    try {
      const existing = await this.client.getRoomStateEvent(roomId, ROOM_EMOTES_EVENT, "");
      return this.normalizePackContent(existing);
    } catch {
      return { images: {} };
    }
  }

  private async getPersonalPack(): Promise<EmotePackContent> {
    try {
      const existing = await this.client.getAccountData<EmotePackContent>(USER_EMOTES_EVENT);
      return this.normalizePackContent(existing);
    } catch {
      return { images: {} };
    }
  }

  private normalizePackContent(value: unknown): EmotePackContent {
    const content = (value ?? {}) as Partial<EmotePackContent>;
    return {
      images: content.images ?? {},
      pack: content.pack,
    };
  }
}
