# Matrix 7TV Emote Bot

A Matrix bot that lets users search 7TV emotes and add them to Matrix emote packs from chat.

## Features

- `/add-emote <query>` to search 7TV and pick a result interactively
- Preview image messages for search results
- Supports adding to room emote pack or personal emote pack
- Room pack permission checks
- Custom shortcode naming with validation
- Cancel and timeout handling for interactive flows

## Commands

- `/add-emote <search query>` - search and add a 7TV emote
- `/help` or `/7tv-help` - show help
- `/cancel` - cancel current selection flow

## Requirements

- Matrix homeserver URL
- Matrix bot account and access token
- Bot invited to the target room(s)
- Docker + Docker Compose
- Node.js 22+ (only needed for local development)

## Quick Start (Docker)

1. Copy environment template:

   ```bash
   cp .env.example .env
   ```

2. Edit `.env` and set:

   ```env
   MATRIX_HOMESERVER_URL=https://matrix.example.com
   MATRIX_ACCESS_TOKEN=syt_xxx
   MATRIX_BOT_USER_ID=@7tv-bot:example.com
   DATA_PATH=/app/data
   SELECTION_TIMEOUT_SEC=60
   ```

3. Build and start:

   ```bash
   docker compose up -d --build
   ```

4. Follow logs:

   ```bash
   docker compose logs -f matrix-7tv-bot
   ```

5. Invite the bot to a room and use `/add-emote pepe`.

## Setup Details

### 1) Create a bot account

Create a dedicated Matrix user on your homeserver, for example:

- `@7tv-bot:example.com`

### 2) Get an access token

You can obtain a token by logging in as the bot account. Common options:

- Use an Element web session and inspect login network responses
- Use your homeserver admin tooling or API to create/access a token

The token value usually starts with `syt_...` on Synapse.

### 3) Room permissions

For room pack updates, the requesting user must have enough power level to send
the `im.ponies.room_emotes` state event in that room. If not, the bot will ask
to use personal pack mode instead.

## Deploy Using Prebuilt Image (GHCR)

This repository is configured to publish to:

- `ghcr.io/victoralensai/matrix-7tv-bot`

After a release tag (for example `v1.0.0`) is pushed, pull and run:

```bash
docker pull ghcr.io/victoralensai/matrix-7tv-bot:latest
docker compose up -d
```

If you want to run prebuilt images instead of local build, replace the service
`build: .` in `docker-compose.yml` with:

```yaml
image: ghcr.io/victoralensai/matrix-7tv-bot:latest
```

Keep the same environment and volume mapping.

## Development

Install dependencies and run locally:

```bash
npm ci
npm test
npm run build
npm run dev
```

## CI/CD

### CI workflow

- File: `.github/workflows/ci.yml`
- Runs on push to `main` and pull requests
- Executes:
  - `npm ci`
  - `npm test`
  - `npm run build`

### Docker publish workflow

- File: `.github/workflows/docker-publish.yml`
- Runs on tag pushes matching `v*` and manual dispatch
- Builds with multi-stage `Dockerfile`
- Pushes image to `ghcr.io/victoralensai/matrix-7tv-bot`
- Uses GitHub Container Registry permissions from `GITHUB_TOKEN`

To publish:

```bash
git tag v1.0.0
git push origin v1.0.0
```

## Troubleshooting

- `Missing required environment variable`:
  - Check `.env` values are set correctly.
- Bot starts but does not respond:
  - Ensure the bot account is invited to the room.
  - Ensure the sent message is plain text and uses supported commands.
- Room pack add fails with permissions:
  - Increase user power level for `im.ponies.room_emotes`, or use personal pack mode.

## License

MIT
