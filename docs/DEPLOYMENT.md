# Deployment

How playtiao.com runs in production, and what a self-hosted copy needs.
For a step-by-step Coolify setup, see [coolify-deployment.md](coolify-deployment.md).

## Production shape

- **Web client**: a static Next.js export (`pnpm build:client` writes
  `client/out/`), served by Cloudflare Workers static assets
  (`client/wrangler.jsonc`). The Cloudflare zone sends `/api` and `/ws` to the
  game server, so the browser talks to one origin.
- **Game server**: Express and WebSocket on a single Node.js process, built
  from `server/Dockerfile` and run as a Docker container (Coolify on a VPS for
  playtiao.com).
- **Data**: MongoDB for accounts and games, S3-compatible storage for profile
  pictures, and optional Redis for distributed matchmaking, locks and rate
  limiting.

`client/serve-export.mjs` (`pnpm --dir client start`) previews the static export
locally the way Cloudflare serves it.

## Environment variables

**Game server, required:**

- `MONGODB_URI`: MongoDB connection string
- `TOKEN_SECRET`: secret for session token hashing (also the `BETTER_AUTH_SECRET` fallback)
- `S3_BUCKET_NAME`, `S3_PUBLIC_URL`: storage for profile picture uploads
- `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`

**Game server, optional:**

- `FRONTEND_URL`: for CORS and the better-auth base URL
- `S3_ENDPOINT`, `S3_FORCE_PATH_STYLE`: for S3-compatible providers (RustFS, MinIO and others)
- `REDIS_URL`: enables distributed matchmaking, locks and rate limiting (falls back to in-memory)
- `PORT`: server port (5005 with `pnpm dev:fixed`)
- `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`: GitHub OAuth
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`: Google OAuth
- `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`: Discord OAuth
- `APPLE_*`: Sign in with Apple (see the comments in `server/.env.example`)

`server/.env.example` and `client/.env.example` list every variable with
comments.

## CI/CD

`.github/workflows/build-and-deploy.yml` runs on every push to `main`:

1. `build-web` builds the documentation site (`docs-site/`) and the static
   client, copies the docs to `/docs` in the export, and uploads a new
   Cloudflare Worker version that serves no traffic yet.
2. `build-server` builds the server image, pushes it to
   `ghcr.io/trebeljahr/tiao-server`, and triggers a Coolify deployment when the
   Coolify secrets are set.
3. `deploy-web` waits until the game server of the same commit answers on
   `/health`, then makes the new Worker version live.

`.github/workflows/tests.yml` runs the unit and integration tests on the same
push, plus the end-to-end tests when the change can affect them.
Desktop and mobile builds and store uploads run only when started by hand; see
[RELEASING-desktop.md](RELEASING-desktop.md) and
[releasing-mobile.md](releasing-mobile.md).
