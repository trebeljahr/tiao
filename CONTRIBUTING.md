# Contributing to Tiao

Thanks for your interest in contributing to Tiao! This guide will help you get set up and understand how the project works.

## Prerequisites

- **Node.js 22.x** (see `.nvmrc` or `engines` in `package.json`)
- **MongoDB** running locally (for account features and game persistence)
- **npm** (comes with Node.js)
- **Redis** (optional — for distributed matchmaking and rate limiting; the server falls back to in-memory stores)

## Getting Started

1. Fork the repo and clone your fork:

```bash
git clone https://github.com/YOUR_USERNAME/tiao.git
cd tiao
```

2. Install dependencies for all packages:

```bash
npm install
cd server && npm install && cd ..
cd client && npm install && cd ..
```

3. Set up environment variables:

```bash
cp server/.env.example server/.env
cp client/.env.example client/.env
```

Edit `server/.env` with your MongoDB connection string and a random token secret. S3/CloudFront variables are optional for local development (profile picture uploads won't work without them).

4. Start the development servers:

```bash
npm run dev
```

This runs the Vite frontend on `http://localhost:3000` and the Express backend on `http://localhost:5005`. Vite proxies `/api` and `/ws` to the backend automatically.

5. Open `http://localhost:3000` in your browser.

## Project Structure

```
tiao/
├── client/          React + Vite + Tailwind frontend
├── server/          Express + WebSocket backend
├── shared/          Pure TypeScript game engine + protocol types
├── e2e/             Playwright end-to-end tests
└── docs/            Documentation
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for a deeper dive into the system design.

## Git Workflow (Rebase Only)

This project uses a **rebase-only** workflow — no merge commits. The repo is configured with `merge.ff = only` and `pull.rebase = true` to enforce this.

1. Create a branch for your work:

```bash
git checkout -b your-feature-name
```

2. Make your changes. The dev server has hot reload for both client and server.

3. Run the tests:

```bash
# Server unit tests
npm --prefix server test

# Client unit tests
cd client && npx vitest run

# E2E tests (servers must be running)
npx playwright test
```

4. Commit your changes with a clear, lowercase message:

```bash
git commit -m "add matchmaking timeout handling"
```

The project uses lowercase imperative style for commit messages (e.g., "fix lobby crash", "add friend search", "refactor game service locking").

5. Before merging, rebase onto main:

```bash
git rebase main
```

6. Merge with fast-forward only:

```bash
git checkout main
git merge --ff-only your-feature-name
```

If the merge fails, rebase your branch onto main first. The `merge.ff = only` config will refuse to create merge commits.

7. Push and open a pull request (or push main directly if you have access).

## Code Organization

### Shared game engine (`shared/src/tiao.ts`)

All game rules live here as pure functions. If you're changing game mechanics, this is where to start. The engine has no side effects and no I/O -- it takes a `GameState` and returns a new one (or a rule violation).

### Server (`server/`)

The server orchestrates multiplayer games, authentication, and social features. Key files:

- `game/gameService.ts` -- core game service that validates moves, manages connections, and broadcasts state
- `game/gameStore.ts` -- persistence layer (MongoDB in production, in-memory for tests)
- `routes/` -- Express route handlers
- `auth/playerSessionStore.ts` -- session management

### Client (`client/src/`)

The frontend is organized around pages and hooks:

- `pages/` -- one file per route (Lobby, Local, Computer, Multiplayer, Matchmaking, Friends, Games, Profile)
- `lib/hooks/` -- state management hooks for each feature
- `lib/api.ts` -- HTTP and WebSocket client
- `components/` -- shared UI components

## Testing

All changes should include tests where applicable. See [docs/TESTING.md](docs/TESTING.md) for the full testing guide, including how the test harnesses work and how to add new tests.

Quick summary:
- **Game rule changes** -- add tests in `server/tests/tiaoCore*.test.ts` using the board ASCII harness
- **API route changes** -- add tests in `server/tests/api.test.ts` or `authRoutes.test.ts`
- **Service logic changes** -- add tests in `server/tests/gameService*.test.ts`
- **Client hook changes** -- add tests in `client/src/lib/hooks/`
- **User-facing flows** -- add E2E tests in `e2e/`

## Documentation

If your change affects the API, game rules, or architecture, please update the relevant doc in `docs/`:

- [docs/API.md](docs/API.md) -- REST and WebSocket reference
- [docs/GAME_RULES.md](docs/GAME_RULES.md) -- game rules
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) -- system design
- [docs/TESTING.md](docs/TESTING.md) -- testing guide

## Need Help?

- Read the [architecture overview](docs/ARCHITECTURE.md) to understand how the pieces fit together
- Check the [API reference](docs/API.md) for endpoint details
- Look at existing tests for patterns to follow
- Open an issue if something is unclear
