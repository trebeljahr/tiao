# Tiao On Coolify

## Local Development With Docker Compose

For local development, a `docker-compose.dev.yml` provides MongoDB and MinIO (S3-compatible object storage) so you don't need external services or a custom `.env` file.

```bash
# Start local infrastructure
npm run dev:infra

# Start the app (uses server/.env.development defaults automatically)
npm run dev
```

The MinIO console is at `http://localhost:9001` (user: `minioadmin`, password: `minioadmin`). Uploaded files are stored in the `tiao-dev` bucket.

Convenience scripts:

| Command                   | What it does                                               |
| ------------------------- | ---------------------------------------------------------- |
| `npm run dev:infra`       | Start MongoDB + MinIO containers (persists across reboots) |
| `npm run dev:infra:stop`  | Stop containers, keep data                                 |
| `npm run dev:infra:reset` | Stop containers and delete all data (clean slate)          |

If you have a `server/.env` file, those values take precedence over `.env.development`. To use the local Docker setup, either delete `server/.env` or ensure it doesn't set conflicting values.

---

Tiao is now set up to deploy as two applications:

- a frontend container built from [client/Dockerfile](/Users/rico/projects/tiao/client/Dockerfile)
- a backend container built from [server/Dockerfile](/Users/rico/projects/tiao/server/Dockerfile)

The recommended production shape still keeps a single browser origin:

- the frontend serves the SPA
- either the frontend proxies `/api` and `/api/ws` to the backend over the private network, or Coolify path-routes those same paths directly to the backend
- the backend does not serve frontend assets anymore

## Recommended production shape

Use two Coolify applications built from this repo:

- `tiao-client`: public, built from [client/Dockerfile](/Users/rico/projects/tiao/client/Dockerfile)
- `tiao-server`: internal or public as needed, built from [server/Dockerfile](/Users/rico/projects/tiao/server/Dockerfile)

Recommended dependencies:

- MongoDB: external managed MongoDB, or a Coolify MongoDB resource
- Object storage: S3, Cloudflare R2, Hetzner Object Storage, or MinIO
- Redis (optional): enables distributed matchmaking, locks, and rate limiting for multi-instance deployments. Not required for single-instance setups — the server falls back to in-memory stores.

MongoDB backs more than account metadata here:

- multiplayer room persistence
- social data
- opaque session storage for the `HttpOnly` auth cookie

## What `localhost` Means In Coolify

When Coolify shows a server named `localhost`, that is the actual machine where Coolify itself is installed.

For your current setup, that means:

- the Hetzner VPS is the one and only deployment server
- Tiao can run on that same server
- a Coolify MongoDB resource can also run on that same server

You do not need to add another server just because the current one is named `localhost`.

## Coolify Application Settings

### Backend app

Suggested base settings:

- Application Type: `Docker Image`
- Registry image name: `ghcr.io/<owner>/<repo>-server`
- Registry image tag: `main`
- Port: `3000`
- Health Check Path: `/api/health`
- Domain: optional

The backend does not need a public domain if the frontend proxies traffic to it over the internal network.
If you want to keep a single public domain without depending on an internal upstream hostname, you can instead attach path-based domains:

- `https://tiao.your-domain.com/api`
- `https://tiao.your-domain.com/api/ws`

### Frontend app

Suggested base settings:

- Application Type: `Docker Image`
- Registry image name: `ghcr.io/<owner>/<repo>-client`
- Registry image tag: `main`
- Port: `80`
- Health Check Path: `/healthz`
- Domain: `https://tiao.your-domain.com`

Important:

- do not put `:main` inside the image name field
- put `main` in the image tag field
- if the image is private, add GHCR credentials in Coolify first

If you prefer image-based deploys instead of building on the VPS:

- publish from GitHub Actions to both `ghcr.io/<owner>/<repo>-client:main` and `ghcr.io/<owner>/<repo>-server:main`
- point each Coolify app at the matching image
- add these GitHub secrets so pushes to `main` trigger a redeploy through the Coolify API:
  - `COOLIFY_BASE_URL`
  - `COOLIFY_API_TOKEN`
  - `COOLIFY_CLIENT_RESOURCE_UUID`
  - `COOLIFY_SERVER_RESOURCE_UUID`

If the repository or package is private:

- add a GHCR registry entry in Coolify
- use a GitHub personal access token with package read access
- configure both Coolify apps to pull from that private registry

## Required Environment Variables

Start from [server/.env.example](/Users/rico/projects/tiao/server/.env.example).

Required:

- `MONGODB_URI`
- `TOKEN_SECRET`
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

- the backend `FRONTEND_URL` should be the public frontend URL if you want strict CORS when accessing the backend directly
- `S3_ENDPOINT` and `S3_FORCE_PATH_STYLE=true` are useful for MinIO and some S3-compatible providers.

Frontend runtime variables:

- `BACKEND_UPSTREAM=http://tiao-server:3000`

Notes:

- `BACKEND_UPSTREAM` is only needed in frontend-proxy mode
- if you use Coolify path-based routing on the same public domain for `/api` and `/api/ws`, the frontend app can leave `BACKEND_UPSTREAM` unset

Recommended values for a first production deploy:

- `FRONTEND_URL=https://tiao.your-domain.com`
- `MONGODB_URI=<Coolify Mongo internal URL or managed Mongo URL>`
- `PORT=3000` or simply omit `PORT` and let the backend default to `3000`
- `BACKEND_UPSTREAM=http://<coolify-internal-backend-host>:3000`

Recommended values for a single-domain Coolify path-routing deploy:

- frontend domain: `https://tiao.your-domain.com`
- backend domains: `https://tiao.your-domain.com/api,https://tiao.your-domain.com/api/ws`
- `FRONTEND_URL=https://tiao.your-domain.com`
- backend `PORT=3000` or omit it
- no extra public backend hostname is required

## Step-By-Step First Deploy

1. Push the Tiao repo to GitHub.
2. Let GitHub Actions build and publish both `ghcr.io/<owner>/<repo>-client:main` and `ghcr.io/<owner>/<repo>-server:main`.
3. In Coolify, add GHCR as a registry if the images are private.
4. In Coolify, create a MongoDB resource in the same project and environment as Tiao.
5. Deploy the MongoDB resource.
6. Copy the MongoDB resource's internal connection string.
7. Create a new backend application of type `Docker Image`.
8. Point it at `ghcr.io/<owner>/<repo>-server:main`.
9. Set the backend port to `3000`.
10. Set the backend health check path to `/api/health`.
11. Add backend runtime environment variables from [server/.env.example](/Users/rico/projects/tiao/server/.env.example).
12. Replace `MONGODB_URI` with the Coolify Mongo internal URL, not `localhost`.
13. Set `FRONTEND_URL` to the eventual public frontend URL.
14. Deploy the backend once and confirm `/api/health` is healthy.
15. Create a new frontend application of type `Docker Image`.
16. Point it at `ghcr.io/<owner>/<repo>-client:main`.
17. Set the frontend port to `80`.
18. Set the frontend health check path to `/healthz`.
19. Attach the public domain, for example `https://tiao.ricos.site`.
20. Set `BACKEND_UPSTREAM` to the backend app's internal URL, for example `http://tiao-server:3000`.
21. Deploy the frontend once and confirm the site loads at the public domain.
22. After the first successful deploy, keep using the GitHub Actions workflow for ongoing redeploys.

Important:

- do not copy your local development `PORT=5005` into production
- the recommended backend port for this image is `3000`
- the recommended frontend port for this image is `80`

## DNS / Proxy Notes

Tiao expects the frontend domain to receive:

- normal HTTPS traffic for the SPA
- API requests at `/api`
- websocket upgrade requests at `/api/ws`

Whether you use the frontend proxy or Coolify path-based routing, the browser can keep using one origin. That means:

- no cross-site cookies are required
- no browser-facing CORS complexity is required in the default production setup
- multiplayer websocket URLs continue to work without special browser configuration

If `https://tiao.your-domain.com` returns a response from Coolify or Traefik, then DNS and HTTPS are at least partially working.

If you see `no available server`, that usually means:

- the domain reached the reverse proxy
- but the proxy does not currently see a healthy frontend container to route traffic to

For Tiao, that almost always means the frontend is crashing, restarting, or failing `/healthz`, or the frontend cannot reach the backend upstream.

## Deploy Flow

1. Push to `main`
2. GitHub Actions runs build + tests
3. GitHub Actions builds and publishes both Docker images to GHCR
4. GitHub Actions calls the Coolify deploy API for both app UUIDs
5. Coolify pulls the updated images and replaces the running containers

## Recommended Workflow For This Repo

For now, the recommended setup is:

- GitHub Actions builds the frontend and backend images
- GHCR stores both images
- Coolify deploys both images on the VPS

That keeps build load off the VPS while still using Coolify for domains, env vars, health checks, logs, proxying, and app lifecycle.

## Coolify API Setup

To use the documented API deployment flow:

1. In Coolify, enable the API.
2. Create an API token in `Keys & Tokens`.
3. Copy the application UUIDs from both Coolify apps.
4. Save these GitHub repository secrets:
   - `COOLIFY_BASE_URL`
   - `COOLIFY_API_TOKEN`
   - `COOLIFY_CLIENT_RESOURCE_UUID`
   - `COOLIFY_SERVER_RESOURCE_UUID`

## Troubleshooting

### `TOKEN_SECRET not provided in the environment`

The backend is starting, but required runtime env vars are missing.

Fix:

- add the missing variables in the backend Coolify app settings
- save and redeploy

### `connect ECONNREFUSED 127.0.0.1:27017`

The backend is trying to connect to MongoDB on `localhost`, which means "inside the backend container itself".

Fix:

- do not use your local development Mongo URI in production
- create a MongoDB resource in Coolify or use an external MongoDB
- copy the database `internal URL` or managed URL into `MONGODB_URI`

### `no available server` on the public domain

This usually means Traefik is up, but the frontend container is not healthy enough to receive traffic.

Check:

- the frontend app logs
- the deployment logs
- that the frontend port is `80`
- that the frontend health check path is `/healthz`
- that `BACKEND_UPSTREAM` points at the backend internal URL
- that the public domain is attached to the frontend app, not only present in DNS

Common gotcha:

- the backend may be healthy while the frontend still fails to serve the app because `BACKEND_UPSTREAM` is wrong
- another common issue is mapping the frontend app to `3000` instead of `80`

### HTTPS does not seem to be working

If the browser reaches `https://...` at all, Coolify's proxy is already handling TLS.

If the app page still fails, the issue is usually frontend health or frontend-to-backend proxying, not certificate setup.

### Image pull or deploy errors from GHCR

Check:

- backend image name is `ghcr.io/<owner>/<repo>-server`
- frontend image name is `ghcr.io/<owner>/<repo>-client`
- tag is `main`
- the apps are not accidentally configured with `:main` inside the image name field
- Coolify has registry credentials if the images are private

## What To Automate Later

The most manual parts today are:

- creating the frontend and backend Coolify apps
- creating the MongoDB resource
- wiring registry credentials
- copying both app UUIDs and API tokens into GitHub secrets
- copying backend/frontend runtime env vars into Coolify

These are good candidates for the reusable ops repo later via:

- Coolify API scripts
- env templates
- secrets bootstrap helpers
- a standard "new app" checklist

## Realtime Limitation

Tiao currently keeps live multiplayer socket state inside one Node.js process. Deploys are graceful, but active multiplayer matches may briefly reconnect while the container is replaced.

That is acceptable for a single-instance hobby deployment, but true zero-downtime realtime play would require shared realtime state outside the process.
