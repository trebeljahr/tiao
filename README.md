# Tiao

Tiao is a monorepo with:
- `client/`: Vite + React frontend
- `server/`: Express + WebSocket backend
- `shared/`: shared protocol and game logic

## Deployment shape

Production is designed to run as a single web app:
- the frontend is built into `client/build`
- the Express server serves that build
- the WebSocket endpoint is exposed at `/ws`

That shape works well with Coolify because the browser can stay on the same origin for both HTTP and WebSocket traffic.

## Coolify / Docker deployment

This repo includes:
- [Dockerfile](/Users/rico/projects/tiao/Dockerfile)
- [.dockerignore](/Users/rico/projects/tiao/.dockerignore)
- [build-and-deploy.yml](/Users/rico/projects/tiao/.github/workflows/build-and-deploy.yml)
- [server/.env.example](/Users/rico/projects/tiao/server/.env.example)

The Docker image:
- builds the client
- compiles the TypeScript server
- serves the built frontend from the Node container
- exposes a DB-aware health endpoint at `/api/health`
- waits for Mongo before accepting traffic

## Required environment variables

See [server/.env.example](/Users/rico/projects/tiao/server/.env.example) for a concrete template.

Core variables:
- `MONGODB_URI`
- `TOKEN_SECRET`
- `ALTCHA_HMAC_KEY`
- `S3_BUCKET_NAME`
- `S3_PUBLIC_URL` or `CLOUDFRONT_URL`
- `AWS_REGION`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`

Optional for S3-compatible providers:
- `S3_ENDPOINT`
- `S3_FORCE_PATH_STYLE`

Notes:
- `PORT` defaults to `3000` if not provided.
- `FRONTEND_URL` is optional and is mainly useful when you want stricter CORS behavior.

## CI/CD

The GitHub Actions workflow:
- installs dependencies
- runs the repo build
- runs server tests
- builds and pushes a Docker image to GHCR on every push to `main`

If you set these GitHub secrets, the workflow will also trigger a Coolify deployment after the image push:
- `COOLIFY_BASE_URL`
- `COOLIFY_API_TOKEN`
- `COOLIFY_RESOURCE_UUID`

There is also a legacy fallback for `COOLIFY_DEPLOY_WEBHOOK`, but the API-based deploy is the cleaner documented path.

There is a concrete Coolify setup guide in [docs/coolify-deployment.md](/Users/rico/projects/tiao/docs/coolify-deployment.md).

## Realtime deployment note

Tiao multiplayer currently keeps live room/socket coordination in a single Node process. That means deploys can be graceful, but active websocket matches may briefly reconnect during a deployment. True near-zero-downtime multiplayer would require shared realtime state outside the process.
