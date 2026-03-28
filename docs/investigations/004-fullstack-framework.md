# Investigation: Full-Stack Framework vs Custom Setup

**Status:** Decided (custom setup)
**Date:** Ongoing since project inception

## Context

The project is a real-time multiplayer board game with a custom game engine, WebSocket-based game state sync, and a self-hosted deployment model. Full-stack frameworks like Wasp, create-t3-app, Blitz.js, and RedwoodJS promise faster development with conventions and code generation.

## Options Considered

### Wasp

- Full-stack framework with declarative DSL for defining app structure
- Generates React + Node.js + Prisma boilerplate
- Good for CRUD apps with auth, but limited control over real-time infrastructure
- WebSocket handling is not a first-class concern
- Opinionated about database (Prisma/PostgreSQL) — project uses MongoDB

### create-t3-app

- Scaffolding tool for Next.js + tRPC + Prisma + Tailwind + NextAuth
- TypeScript-first, good DX
- Assumes PostgreSQL + Prisma (project uses MongoDB + Mongoose)
- No built-in WebSocket support
- More of a starting template than a framework — less lock-in but less ongoing value

### Blitz.js / RedwoodJS

- Full-stack React frameworks with conventions for data layer
- Designed for traditional web apps, not real-time game servers
- Would constrain the custom WebSocket architecture and shared game engine pattern

### Custom Monorepo (chosen)

- `client/` (React, originally Vite, now Next.js) + `server/` (Express + ws) + `shared/` (pure game engine)
- Full control over WebSocket architecture, game state sync, and deployment
- Each layer can evolve independently (Vite → Next.js happened without touching server)
- No framework overhead or conventions fighting the game's requirements

## Outcome

Custom setup was chosen — never formally evaluated alternatives because the project's requirements are a poor fit for full-stack frameworks:

1. **Real-time WebSocket game state** with custom per-game rooms, lobby connections, and ping/pong — frameworks treat WebSocket as an afterthought
2. **Shared pure-function game engine** imported by both client and server — frameworks don't accommodate a `shared/` package pattern
3. **Optimistic client updates with server-authoritative validation** — requires tight control over the data flow that frameworks abstract away
4. **Custom session model** (HMAC cookies, not JWT or framework-provided auth) — chosen for specific security properties
5. **Pluggable storage abstractions** (in-memory fallback for dev, Redis for prod) — frameworks assume a specific database

The server was originally extracted from another project, which further reinforced the custom approach. The tradeoff is more boilerplate and manual wiring, but complete control over every architectural decision.
