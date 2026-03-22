# Matrix 7TV Emote Bot - Project Plan

## Overview

A Matrix bot that allows users to search and add 7TV emotes to Matrix emote/sticker packs via chat commands.

**Key Features:**
- `/add-emote <search>` command to search 7TV
- `/add-emote-by-link <7tv link or ID>` for direct emote add
- Reply-based selection UI with preview images
- Support for room emote packs and canonical parent space packs
- Permission checking for room/space packs
- Threaded bot flow with HTML-formatted replies and mentions
- Animated emote support (WebP)
- Docker deployment

**Tech Stack:**
- TypeScript
- matrix-bot-sdk
- Docker (for VPS deployment)

---

## Project Structure

```
matrix-7tv-bot/
├── src/
│   ├── index.ts              # Entry point
│   ├── bot.ts                # Matrix bot setup
│   ├── commands/
│   │   ├── addEmote.ts       # /add-emote handler
│   │   ├── addEmoteByLink.ts # /add-emote-by-link handler
│   │   └── help.ts           # /help handler
│   ├── services/
│   │   ├── sevenTv.ts        # 7TV API client
│   │   ├── emotePack.ts      # Matrix emote pack management
│   │   └── mediaUpload.ts    # Matrix media upload
│   ├── session/
│   │   └── selectionManager.ts  # Track user selection flows
│   └── config.ts             # Configuration
├── Dockerfile
├── docker-compose.yml
├── package.json
├── tsconfig.json
└── .env.example
```

---

## Phases

### Phase 1: Research & Setup

| Task | Status | Notes |
|------|--------|-------|
| 1.1 Set up TypeScript project with matrix-bot-sdk | [x] | Done - basic project structure, Docker setup |
| 1.2 Research 7TV API v3 - search endpoints, emote formats | [x] | Uses GraphQL at /v3/gql, see notes below |
| 1.3 Research Matrix emote state events | [x] | `im.ponies.room_emotes` for room, `im.ponies.emote_rooms` for enabling packs |
| 1.4 Understand Matrix media upload (mxc:// URIs) | [x] | `client.uploadContent(buffer, contentType, filename)` returns mxc:// |

### Phase 2: Core Bot Infrastructure

| Task | Status | Notes |
|------|--------|-------|
| 2.1 Create bot skeleton with matrix-bot-sdk | [x] | Done - client creation, autojoin, startup logging |
| 2.2 Implement command parsing (`/add-emote <search>`) | [x] | Done - dedicated parser + command handling for `/add-emote`, `/help`, `/cancel` |
| 2.3 Implement session management (track user selection mode) | [x] | Done - in-memory session manager with timeout refresh + cleanup |
| 2.4 Set up configuration (homeserver, access token, etc.) | [x] | Done - env validation + configurable selection timeout |

### Phase 3: 7TV Integration

| Task | Status | Notes |
|------|--------|-------|
| 3.1 Implement 7TV search API client | [x] | Done - `SevenTvService.searchEmotes()` via GraphQL |
| 3.2 Fetch emote metadata and WebP URLs | [x] | Done - animated flag + file variants + best WebP URL selection |
| 3.3 Download emotes (WebP format) | [x] | Done - `SevenTvService.downloadEmoteWebp()` returns Buffer |
| 3.4 Handle edge cases (animated emotes, size limits) | [x] | Animated metadata supported; size-limit checks intentionally omitted (explicitly out of scope) |

### Phase 4: Emote Pack Management

| Task | Status | Notes |
|------|--------|-------|
| 4.1 Check user permissions for room emote packs | [x] | Done - `userHasPowerLevelFor(..., im.ponies.room_emotes, true)` check before room target |
| 4.2 Implement room emote pack state event updates | [x] | Done - `EmotePackService.addToRoomPack()` updates `im.ponies.room_emotes` state key `""` |
| 4.3 Implement room/space pack targeting | [x] | Done - discovers editable room packs + canonical parent space packs |
| 4.4 Handle emote naming (default from 7TV, allow override) | [x] | Done - default name + custom override + validation (`[a-zA-Z0-9-_]+`, <=100 bytes) |

### Phase 5: User Flow Implementation

| Task | Status | Notes |
|------|--------|-------|
| 5.1 `/add-emote <search>` - search and show results | [x] | Done - live 7TV search integrated |
| 5.2 Show numbered list with emote preview images | [x] | Done - bot sends `m.image` preview events for each result and falls back to URL text if preview upload fails |
| 5.3 Ask for pack target (room/space/create) | [x] | Done - list existing packs and optional create-new targets |
| 5.4 Ask for name confirmation/override | [x] | Done - `ok` keeps default, any valid shortcode overrides |
| 5.5 Upload to Matrix media, add to pack, confirm success | [x] | Done - download WebP, upload MXC, write to selected pack |

### Phase 6: Polish & Edge Cases

| Task | Status | Notes |
|------|--------|-------|
| 6.1 Timeout handling for selections (60s) | [x] | Done - configurable timeout + periodic cleanup |
| 6.2 Cancel command mid-flow | [x] | Done - `/cancel` command and `cancel` reply support |
| 6.3 Error handling (7TV down, no results, duplicate names) | [x] | Done - specific handling for 7TV search/download failures, duplicate shortcode prompt, and permission-related failures |
| 6.4 Help command | [x] | Done - `/help` and `/7tv-help` |
| 6.5 Docker setup | [x] | Done - Dockerfile + compose already present; `docker compose config` validated successfully |

---

## User Flow

```
User:  /add-emote pepe
Bot:   Found 5 emotes for "pepe":
       [preview1] 1. pepeLaugh
       [preview2] 2. Pepega
       [preview3] 3. pepeHands
       [preview4] 4. pepeD
       [preview5] 5. PEPEDS
       Reply with a number to select (or "cancel").

User:  2

Bot:   Selected: Pepega
       Add to which pack?
       1. Default Pack (this room) [default]
       2. Space Pack (space: My Space) [default]
       3. Create new pack in this room
       4. Create new pack in space My Space

User:  1

Bot:   Name for emote (default: Pepega). Reply with name or "ok" to use default:

User:  ok

Bot:   ✓ Added :Pepega: to this room's emote pack!
```

---

## Technical Research Notes

### 7TV API

- **Base URL**: `https://7tv.io/v3/`
- **Search**: GraphQL `POST /v3/gql`
- **Query fields used**: `id`, `name`, `animated`, `host.url`, `host.files{name,format}`
- **CDN**: `https://cdn.7tv.app/emote/<id>/<size>.webp`
  - Sizes: 1x, 2x, 3x, 4x
  - Animated emotes expose `animated: true` and include animated file variants

### Matrix Emote Packs

- **Room emotes**: State event type `im.ponies.room_emotes`
  - State key can be empty string for default pack, or a pack name
  - Format: `{ "images": { "emote_name": { "url": "mxc://..." } }, "pack": { "display_name": "Pack Name" } }`

- **Space emote packs**: Also use `im.ponies.room_emotes`, written in canonical parent space room
  - Canonical parent discovery uses `m.space.parent` with `canonical: true`
  - Space room is validated as `m.space` via `m.room.create`

### Matrix Media Upload

- Use `client.uploadContent(buffer, mimeType, filename)`
- Returns `mxc://` URI
- WebP MIME type: `image/webp`

---

## Challenges & Issues Log

| Date | Issue | Resolution |
|------|-------|------------|
| 2026-03-22 | 7TV REST search endpoint assumption (`/v3/emotes?query=...`) did not return expected data | Switched to GraphQL endpoint `https://7tv.io/v3/gql`, which returns full emote metadata including `animated` and file variants |
| 2026-03-22 | Multi-step chat UX needs state across user replies | Implemented `SelectionManager` with per-user/per-room sessions, timeout extension on activity, and explicit cancellation |
| 2026-03-22 | Early regressions risk while refactoring command/session flow | Added Vitest and unit tests for command parsing and session manager behavior |
| 2026-03-22 | Vitest picked up compiled tests in `dist/` and failed on CommonJS import mode | Added `vitest.config.ts` to include only `src/**/*.test.ts` and exclude `dist/**` |
| 2026-03-22 | Needed emote previews in Matrix chat result list | Added per-result `m.image` preview sending using Matrix media upload, with URL fallback on preview failure |
| 2026-03-22 | Duplicate shortcode collisions and opaque add failures | Added pack duplicate-name checks before upload and more specific user-facing error messages |
| 2026-03-22 | Docker image depended on prebuilt `dist/` artifacts | Switched to a multi-stage Dockerfile that builds TypeScript during image build and ships production-only deps |
| 2026-03-22 | Need automated quality checks and release image publishing | Added GitHub Actions CI (`test` + `build`) and GHCR publish workflow on version tags |
| 2026-03-22 | Pre-v1 docs were outdated after threading/space-pack/link flow changes | Rewrote `README.md` and updated project plan notes for v1 behavior |

---

## Environment Variables

```env
MATRIX_HOMESERVER_URL=https://matrix.example.com
MATRIX_ACCESS_TOKEN=syt_xxxx
MATRIX_BOT_USER_ID=@7tv-bot:example.com
```

---

## Useful Links

- [matrix-bot-sdk docs](https://github.com/turt2live/matrix-bot-sdk)
- [7TV API](https://7tv.io/docs)
- [MSC2545 - Custom Emotes](https://github.com/matrix-org/matrix-spec-proposals/pull/2545)
- [Ponies spec (emotes)](https://github.com/Sorunome/matrix-doc/blob/soru/emotes/proposals/2545-emotes.md)
