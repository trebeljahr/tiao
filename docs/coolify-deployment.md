# Tiao On Coolify

Tiao is set up to deploy as a single web container:
- HTTP API and static frontend share one origin
- multiplayer WebSockets stay on `/ws`
- the container listens on `3000`
- readiness is exposed at `/api/health`

## Recommended production shape

Use one Coolify application built from this repo's [Dockerfile](/Users/rico/projects/tiao/Dockerfile).

Recommended dependencies:
- MongoDB: external managed MongoDB, or a Coolify MongoDB resource
- Object storage: S3, Cloudflare R2, Hetzner Object Storage, or MinIO

## Coolify Application Settings

Suggested base settings:
- Build Pack: `Dockerfile`
- Port: `3000`
- Health Check Path: `/api/health`

If you prefer image-based deploys instead of building on the VPS:
- publish from GitHub Actions to `ghcr.io/<owner>/<repo>:main`
- point the Coolify app at that image
- add these GitHub secrets so pushes to `main` trigger a redeploy through the Coolify API:
  - `COOLIFY_BASE_URL`
  - `COOLIFY_API_TOKEN`
  - `COOLIFY_RESOURCE_UUID`

If the repository or package is private:
- add a GHCR registry entry in Coolify
- use a GitHub personal access token with package read access
- configure the Coolify app to pull from that private registry

## Required Environment Variables

Start from [server/.env.example](/Users/rico/projects/tiao/server/.env.example).

Required:
- `MONGODB_URI`
- `TOKEN_SECRET`
- `ALTCHA_HMAC_KEY`
- `S3_BUCKET_NAME`
- `S3_PUBLIC_URL` or `CLOUDFRONT_URL`
- `AWS_REGION`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`

Optional:
- `FRONTEND_URL`
- `S3_ENDPOINT`
- `S3_FORCE_PATH_STYLE`

Notes:
- `FRONTEND_URL` can be left unset when the app is served from the same origin.
- `S3_ENDPOINT` and `S3_FORCE_PATH_STYLE=true` are useful for MinIO and some S3-compatible providers.

## DNS / Proxy Notes

Tiao expects:
- normal HTTPS traffic on the app domain
- websocket upgrade requests on the same domain at `/ws`

No special client websocket URL configuration is needed if the browser loads the site from the same origin.

## Deploy Flow

1. Push to `main`
2. GitHub Actions runs build + tests
3. GitHub Actions builds and publishes the Docker image to GHCR
4. GitHub Actions calls the Coolify deploy API for the app UUID
5. Coolify pulls the updated image and replaces the running container

## Recommended Workflow For This Repo

For now, the recommended setup is:
- GitHub Actions builds the Docker image
- GHCR stores the image
- Coolify deploys the image on the VPS

That keeps build load off the VPS while still using Coolify for domains, env vars, health checks, logs, and app lifecycle.

## Coolify API Setup

To use the documented API deployment flow:
1. In Coolify, enable the API.
2. Create an API token in `Keys & Tokens`.
3. Copy the application UUID from the Coolify app.
4. Save these GitHub repository secrets:
   - `COOLIFY_BASE_URL`
   - `COOLIFY_API_TOKEN`
   - `COOLIFY_RESOURCE_UUID`

## Realtime Limitation

Tiao currently keeps live multiplayer socket state inside one Node.js process. Deploys are graceful, but active multiplayer matches may briefly reconnect while the container is replaced.

That is acceptable for a single-instance hobby deployment, but true zero-downtime realtime play would require shared realtime state outside the process.
