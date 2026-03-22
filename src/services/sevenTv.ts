export interface SevenTvEmoteFile {
  name: string;
  format: string;
}

export interface SevenTvEmote {
  id: string;
  name: string;
  animated: boolean;
  hostUrl: string;
  files: SevenTvEmoteFile[];
}

interface SevenTvSearchResponse {
  data?: {
    emotes?: {
      items?: Array<{
        id: string;
        name: string;
        animated: boolean;
        host?: {
          url?: string;
          files?: SevenTvEmoteFile[];
        };
      }>;
    };
  };
  errors?: Array<{ message?: string }>;
}

interface SevenTvEmoteByIdResponse {
  id?: string;
  name?: string;
  animated?: boolean;
  host?: {
    url?: string;
    files?: SevenTvEmoteFile[];
  };
}

export class SevenTvService {
  private static readonly GQL_ENDPOINT = "https://7tv.io/v3/gql";
  private static readonly REST_ENDPOINT = "https://7tv.io/v3/emotes";

  public async searchEmotes(query: string, limit = 5): Promise<SevenTvEmote[]> {
    const trimmedQuery = query.trim();
    const fetchLimit = Math.max(limit, limit + 10);
    const requestBody = {
      query:
        "query SearchEmotes($query: String!, $limit: Int!, $sort: Sort, $filter: EmoteSearchFilter) { emotes(query: $query, limit: $limit, sort: $sort, filter: $filter) { items { id name animated host { url files { name format } } } } }",
      variables: {
        query: trimmedQuery,
        limit: fetchLimit,
        sort: { value: "popularity", order: "DESCENDING" },
        filter: { category: "TOP" },
      },
    };

    const response = await fetch(SevenTvService.GQL_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      throw new Error(`7TV API request failed with status ${response.status}`);
    }

    const payload = (await response.json()) as SevenTvSearchResponse;
    if (payload.errors && payload.errors.length > 0) {
      const message = payload.errors[0]?.message || "Unknown GraphQL error";
      throw new Error(`7TV API error: ${message}`);
    }

    const items = payload.data?.emotes?.items ?? [];
    const candidates = items
      .filter((item) => Boolean(item?.id && item?.name && item?.host?.url))
      .map((item) => ({
        id: item.id,
        name: item.name,
        animated: Boolean(item.animated),
        hostUrl: this.normalizeCdnUrl(item.host?.url || ""),
        files: item.host?.files ?? [],
      }))
      .filter((item) => item.hostUrl.length > 0);

    return candidates.slice(0, limit);
  }

  public async getEmoteById(emoteId: string): Promise<SevenTvEmote> {
    const response = await fetch(`${SevenTvService.REST_ENDPOINT}/${encodeURIComponent(emoteId)}`);

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`7TV emote not found: ${emoteId}`);
      }
      throw new Error(`7TV emote request failed with status ${response.status}`);
    }

    const payload = (await response.json()) as SevenTvEmoteByIdResponse;
    if (!payload.id || !payload.name || !payload.host?.url) {
      throw new Error(`7TV emote response missing required fields for ${emoteId}`);
    }

    return {
      id: payload.id,
      name: payload.name,
      animated: Boolean(payload.animated),
      hostUrl: this.normalizeCdnUrl(payload.host.url),
      files: payload.host.files ?? [],
    };
  }

  public getBestWebpUrl(emote: SevenTvEmote): string {
    const preferredNames = ["4x.webp", "3x.webp", "2x.webp", "1x.webp"];
    for (const preferred of preferredNames) {
      const found = emote.files.find((file) => file.name.toLowerCase() === preferred);
      if (found) {
        return `${emote.hostUrl}/${found.name}`;
      }
    }

    return `${emote.hostUrl}/4x.webp`;
  }

  public async downloadEmoteWebp(emote: SevenTvEmote): Promise<Buffer> {
    const webpUrl = this.getBestWebpUrl(emote);
    return this.downloadFromUrl(webpUrl);
  }

  public async downloadFromUrl(url: string): Promise<Buffer> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download emote from ${url}: ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  private normalizeCdnUrl(url: string): string {
    if (!url) return "";
    if (url.startsWith("https://") || url.startsWith("http://")) {
      return url;
    }
    if (url.startsWith("//")) {
      return `https:${url}`;
    }
    return `https://${url.replace(/^\/+/, "")}`;
  }

}
