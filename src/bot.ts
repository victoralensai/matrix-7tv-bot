import {
  MatrixClient,
  SimpleFsStorageProvider,
  AutojoinRoomsMixin,
  LogService,
  LogLevel,
} from "matrix-bot-sdk";
import { Config } from "./config";

export async function createBot(config: Config): Promise<MatrixClient> {
  // Set up logging
  LogService.setLevel(LogLevel.INFO);

  // Storage for sync token and other state
  const storage = new SimpleFsStorageProvider(`${config.dataPath}/bot.json`);

  // Create the client
  const client = new MatrixClient(
    config.homeserverUrl,
    config.accessToken,
    storage
  );

  // Automatically join rooms when invited
  AutojoinRoomsMixin.setupOnClient(client);

  return client;
}
