# Matrix 7TV Emote Bot

A Matrix bot that searches 7TV and adds emotes to Matrix emote packs through chat commands.

## Features

- Search 7TV and add emotes with `/add-emote <query>`
- Add an exact emote directly from a 7TV URL/ID with `/add-emote-by-link <link-or-id>`
- Preview images for search results (with text fallback if preview upload fails)
- Add emotes to room packs and canonical parent space packs (`im.ponies.room_emotes`)
- Create new named packs in-room or in the canonical parent space during selection
- Threaded interaction flow to reduce room noise (all prompts/replies stay in a thread)
- HTML-formatted bot messages with Matrix mentions
- Duplicate shortcode checks and validation (`[a-zA-Z0-9-_]`, max 100 bytes)
- Timeout and cancellation support for interactive sessions

## Commands

| Command | Description |
|---|---|
| `/add-emote <search query>` | Search 7TV, show previews, and start interactive selection |
| `/add-emote-by-link <7tv emote URL or ID>` | Add a specific 7TV emote directly |
| `/cancel` | Cancel your current selection flow |
| `/help` or `/7tv-help` | Show command help |

## Requirements

- Matrix homeserver URL
- Matrix bot account and access token
- Bot invited to target room(s)
- Docker + Docker Compose
- Node.js 22+ (local development only)

## Quick Start (Docker)

1. Copy environment template:

   ```bash
   cp .env.example .env
   ```

2. Edit `.env`:

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

5. Invite the bot to a room and run `/add-emote pepe`.

## Setup Details

### 1) Create a bot account

Create a dedicated Matrix user on your homeserver, for example `@7tv-bot:example.com`.

### 2) Get an access token

You can obtain a token by logging in as the bot account. Common options:

- Use an Element web session and inspect login network responses
- Use homeserver admin tooling or API to create/access a token

The token value often starts with `syt_...` on Synapse.

### 3) Configure permissions for emote packs

- **Room packs**: the bot must be allowed to send `im.ponies.room_emotes` state events in the room.
- **Space packs**: if the room has a canonical parent space, the bot can also target packs in that space. It also needs `im.ponies.room_emotes` rights in the space.
- If the bot has no editable targets, it will reject the flow with a permission guidance message.

### 4) Canonical parent space behavior

Space pack discovery uses `m.space.parent` events with `canonical: true`. If your room is attached to a space but the parent is not marked canonical, space packs will not appear in selection.

### 5) Threading and reply behavior

The bot starts a thread from your command message and keeps the whole multi-step flow there. Replies for selection (numbers, names, `ok`, `cancel`) must be sent in that same thread.

## Deploy Using Prebuilt Image (GHCR)

This repository publishes images to `ghcr.io/victoralensai/matrix-7tv-bot`.

After pushing a release tag (for example `v1.0.0`):

```bash
docker pull ghcr.io/victoralensai/matrix-7tv-bot:latest
docker compose up -d
```

To use prebuilt images instead of local builds, replace `build: .` in `docker-compose.yml` with:

```yaml
image: ghcr.io/victoralensai/matrix-7tv-bot:latest
```

Keep the same environment and volume mapping.

## Development

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
- Executes `npm ci`, `npm test`, and `npm run build`

### Docker publish workflow

- File: `.github/workflows/docker-publish.yml`
- Runs on tag pushes matching `v*` and manual dispatch
- Builds with multi-stage `Dockerfile`
- Pushes image to `ghcr.io/victoralensai/matrix-7tv-bot`

To publish:

```bash
git tag v1.0.0
git push origin v1.0.0
```

## Troubleshooting

| Issue | What to check |
|---|---|
| `Missing required environment variable` | Verify `.env` values are set correctly |
| Bot starts but does not respond | Ensure bot is invited and command is plain `m.text` |
| Replies are ignored during selection | Reply in the same thread started by the bot |
| `M_FORBIDDEN` or permission denied | Grant bot power to send `im.ponies.room_emotes` state events |
| Space packs do not show up | Verify canonical `m.space.parent` points to a valid `m.space` room |
| 7TV lookup fails | Retry later or verify the link/ID exists on 7TV |

## License

MIT
