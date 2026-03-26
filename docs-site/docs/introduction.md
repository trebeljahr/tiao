---
sidebar_position: 1
title: Introduction
slug: /
---

# Tiao

Tiao (跳, "jump") is an open-source multiplayer board game platform — think "lichess for Tiao." Two players place and jump pieces on a 19×19 board, competing to be the first to capture 10 enemy stones. Play locally, against an AI, or online against real opponents with real-time matchmaking.

## The Game

Players take turns placing pieces or jumping over enemy pieces to capture them:

```
  Place a piece:          Jump to capture:

  . . . . .              . . . . .         . . . . .
  . . . . .              . W . . .         . . . . .
  . . W . .              . . B . .   -->   . . x . .
  . . . . .              . . . . .         . . . W .
  . . . . .              . . . . .         . . . . .
```

Jumps can chain -- keep jumping with the same piece if more captures are available. First to 10 captures wins.

Try the [interactive tutorial](https://tiao.ricos.site/tutorial) to learn by playing.

## Features

- **Local play** -- two players on the same device
- **Computer opponent** -- play against an AI
- **Online multiplayer** -- real-time games over WebSocket
- **Matchmaking** -- automatic opponent pairing
- **Friends and invitations** -- add friends, invite them to games
- **Game history** -- browse your past matches
- **Accounts** -- optional signup with profile pictures, or play as a guest

## Quick Start

**Prerequisites:** Node.js 22.x, MongoDB, npm. Optional: Redis (for distributed matchmaking and rate limiting)

### 1. MongoDB

Tiao stores sessions, game rooms, and social data in MongoDB. You need a running MongoDB instance before starting the server.

- **Local install:** follow the [MongoDB Community Edition installation guide](https://www.mongodb.com/docs/manual/installation/)
- **Docker:** `docker run -d -p 27017:27017 mongo:7`
- **Cloud:** create a free cluster on [MongoDB Atlas](https://www.mongodb.com/docs/atlas/getting-started/)

All options give you a connection string in the form `mongodb://...` — that goes into `MONGODB_URI` below.

### 2. Clone and install

```bash
git clone https://github.com/your-org/tiao.git
cd tiao
npm install
```

The root `postinstall` script automatically installs dependencies for `client/`, `server/`, and `docs-site/`.

### 3. Configure environment

```bash
cp server/.env.example server/.env
```

Edit `server/.env` and set at least these two variables:

| Variable | Description |
|----------|-------------|
| `MONGODB_URI` | MongoDB connection string, e.g. `mongodb://localhost:27017/tiao` for a local instance or the connection string from Atlas |
| `TOKEN_SECRET` | Any random string — used to HMAC session tokens. Generate one with `openssl rand -base64 32` |

The remaining variables (`S3_*`, `AWS_*`) are only needed for profile picture uploads. `REDIS_URL` is optional — it enables distributed matchmaking, locks, and rate limiting. When omitted, the server falls back to in-memory stores.

See `server/.env.example` for the full list with descriptions.

### 4. Start development servers

```bash
npm run dev
```

By default, this picks **random free ports** for the client (3100–3999), server (5100–5999), and docs (4100–4999). The chosen URLs are printed on startup. This avoids port conflicts when running multiple instances or worktrees.

If you prefer fixed, predictable ports:

```bash
npm run dev:fixed
```

This starts the client on `http://localhost:3000` and the server on `http://localhost:5005`.

Both modes proxy API and WebSocket requests from the client dev server to the backend automatically.

## Project Structure

```
tiao/
├── client/          React + Vite + Tailwind frontend
├── server/          Express + WebSocket backend
├── shared/          Pure TypeScript game engine + protocol types
├── e2e/             Playwright end-to-end tests
├── docs/            Markdown documentation (source for this site)
└── docs-site/       Docusaurus documentation site
```
