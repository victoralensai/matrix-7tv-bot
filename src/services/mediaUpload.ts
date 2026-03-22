import { MatrixClient } from "matrix-bot-sdk";

export class MediaUploadService {
  public constructor(private readonly client: MatrixClient) {}

  public async uploadWebp(buffer: Buffer, filename: string): Promise<string> {
    return this.client.uploadContent(buffer, "image/webp", filename);
  }

  public async uploadFromUrl(url: string): Promise<string> {
    return this.client.uploadContentFromUrl(url);
  }
}
