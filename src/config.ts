export interface Config {
  homeserverUrl: string;
  accessToken: string;
  botUserId: string;
  dataPath: string;
  selectionTimeoutMs: number;
}

function getEnvOrThrow(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export function loadConfig(): Config {
  const selectionTimeoutSecRaw = process.env.SELECTION_TIMEOUT_SEC;
  const selectionTimeoutSec = selectionTimeoutSecRaw
    ? Number(selectionTimeoutSecRaw)
    : 60;

  if (!Number.isFinite(selectionTimeoutSec) || selectionTimeoutSec <= 0) {
    throw new Error("SELECTION_TIMEOUT_SEC must be a positive number");
  }

  return {
    homeserverUrl: getEnvOrThrow("MATRIX_HOMESERVER_URL"),
    accessToken: getEnvOrThrow("MATRIX_ACCESS_TOKEN"),
    botUserId: getEnvOrThrow("MATRIX_BOT_USER_ID"),
    dataPath: process.env.DATA_PATH || "./data",
    selectionTimeoutMs: Math.floor(selectionTimeoutSec * 1000),
  };
}
