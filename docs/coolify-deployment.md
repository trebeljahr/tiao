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

- the frontend serves the Next.js application via a Node.js server
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
- session storage for better-auth's `HttpOnly` auth cookie

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

- `https://your-domain-example.com/api`
- `https://your-domain-example.com/api/ws`

### Frontend app

Suggested base settings:

- Application Type: `Docker Image`
- Registry image name: `ghcr.io/<owner>/<repo>-client`
- Registry image tag: `main`
- Port: `80`
- Health Check Path: `/healthz`
- Domain: `https://your-domain-example.com`

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
- `REDIS_URL` — enables distributed matchmaking, locks, and rate limiting
- `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` — GitHub OAuth
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` — Google OAuth
- `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` — Discord OAuth
- `BETTER_AUTH_URL` — custom auth base URL (falls back to `FRONTEND_URL`)
- `BETTER_AUTH_SECRET` — auth signing secret (falls back to `TOKEN_SECRET`)
- `LISTMONK_URL`, `LISTMONK_API_USER`, `LISTMONK_API_TOKEN`, `LISTMONK_TX_TEMPLATE_ID`, `LISTMONK_FROM` — account email through Listmonk `/api/tx`; used only when all five are set, and then preferred over Resend
- `RESEND_API_KEY`, `EMAIL_FROM` — account email through Resend

Notes:

- the backend `FRONTEND_URL` should be the public frontend URL — it is used for CORS and as the better-auth base URL
- `S3_ENDPOINT` and `S3_FORCE_PATH_STYLE=true` are useful for MinIO and some S3-compatible providers.

Frontend runtime variables:

- `BACKEND_UPSTREAM=http://tiao-server:3000`

Notes:

- `BACKEND_UPSTREAM` is only needed in frontend-proxy mode
- if you use Coolify path-based routing on the same public domain for `/api` and `/api/ws`, the frontend app can leave `BACKEND_UPSTREAM` unset

Recommended values for a first production deploy:

- `FRONTEND_URL=https://your-domain-example.com`
- `MONGODB_URI=<Coolify Mongo internal URL or managed Mongo URL>`
- `PORT=3000` or simply omit `PORT` and let the backend default to `3000`
- `BACKEND_UPSTREAM=http://<coolify-internal-backend-host>:3000`

Recommended values for a single-domain Coolify path-routing deploy:

- frontend domain: `https://your-domain-example.com`
- backend domains: `https://your-domain-example.com/api,https://your-domain-example.com/api/ws`
- `FRONTEND_URL=https://your-domain-example.com`
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
19. Attach the public domain, for example `https://your-domain-example.com`.
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

If `https://your-domain-example.com` returns a response from Coolify or Traefik, then DNS and HTTPS are at least partially working.

If you see `no available server`, that usually means:

- the domain reached the reverse proxy
- but the proxy does not currently see a healthy frontend container to route traffic to

For Tiao, that almost always means the frontend is crashing, restarting, or failing `/healthz`, or the frontend cannot reach the backend upstream.

### Static offline page (`/503.html`)

[client/public/503.html](/Users/rico/projects/tiao/client/public/503.html) is a plain HTML page (no JS, no external assets, inline CSS) that says Tiao is temporarily offline and lists the contact email, the GitHub repo, and the license. The frontend container serves it at `https://your-domain-example.com/503.html` whenever the app is up, but the point of the page is to be shown when the app is *down*, which the frontend container cannot do for itself.

To show it instead of Traefik's bare `no available server` text, host the file somewhere that stays up independently of `tiao-client`, then point a Traefik `errors` middleware at it:

1. Create a small static Coolify resource (for example an `nginx:alpine` or `static` app) whose document root contains only `503.html`. Give it no public domain; it only needs to be reachable by Traefik on the Coolify proxy network. Note its Traefik service name (`http-<app-uuid>` in Coolify's generated labels, visible under the app's `Labels` tab).
2. On the `tiao-client` app, add these custom Traefik labels (Coolify: `Advanced` → `Custom Docker labels`), replacing `<fallback-service>` with the service name from step 1 and `<router>` with the existing frontend router name from the generated labels:

   ```text
   traefik.http.middlewares.tiao-offline.errors.status=502-504
   traefik.http.middlewares.tiao-offline.errors.service=<fallback-service>
   traefik.http.middlewares.tiao-offline.errors.query=/503.html
   traefik.http.routers.<router>.middlewares=tiao-offline@docker
   ```

   If the router already has a middleware chain (Coolify adds one for gzip and redirects), append `tiao-offline@docker` to the existing comma-separated list instead of overwriting it.
3. Redeploy `tiao-client`. Traefik now answers 502, 503, and 504 responses from the frontend with the static page while keeping the original status code.

Caveats:

- The `errors` middleware only fires when the router still resolves to a service that replies with an error. During a full container replacement Traefik briefly has no backend at all and still returns its own `no available server` text for that window. For a longer planned outage, stop `tiao-client` and attach the public domain to the fallback service directly.
- Keep the fallback page as a separate copy on the static resource. Do not point the middleware at `tiao-client` itself, because a crashed frontend cannot serve its own `/503.html`.
- The frontend serves everything under `public/` with a year-long `immutable` cache header. That is harmless here because the middleware fetches the page from the fallback service, not from the frontend, but keep it in mind if a CDN sits in front of the fallback host.

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

## Docker Debugging Guide

When something goes wrong in a Coolify/Docker deployment, you need to inspect the containers directly. This section covers the most common Docker debugging commands and explains what each one does, so you can diagnose problems even if you are not deeply familiar with Docker.

### Key concept: containers are isolated processes

Each Docker container is an isolated process with its own filesystem, network interfaces, and environment variables. Containers communicate with each other over Docker networks — **not via `localhost`**. When a container tries to reach `localhost`, it is talking to itself, not to another container. This is the most common source of "connection refused" errors in containerized deployments.

In Coolify, containers in the same project share a Docker network and can reach each other by their container/service name (e.g., `tiao-server`, `mongo`). The exact hostname depends on how Coolify names the container — check with `docker inspect`.

### Listing containers

```bash
# Show all running containers with their names, ports, and status
docker ps

# Show all containers including stopped ones
docker ps -a
```

The output shows container IDs, names, ports, and how long each has been running. If a container keeps restarting (`Up 3 seconds` repeatedly), it is crashing on startup — check its logs next.

### Reading container logs

```bash
# View the last 100 lines of a container's output
docker logs --tail 100 <container-name>

# Follow logs in real time (like tail -f)
docker logs -f <container-name>

# Show timestamps alongside each log line
docker logs --tail 50 -t <container-name>
```

Logs show everything the application writes to stdout and stderr. This is where you will see startup errors, crash stack traces, and request logs. Most problems are diagnosable from logs alone.

For Docker Compose services (local development):

```bash
# View logs for all services at once
docker compose logs

# Follow logs for a specific service
docker compose logs -f server
```

### Shelling into a container

```bash
# Open an interactive shell inside a running container
docker exec -it <container-name> sh

# If the container has bash installed
docker exec -it <container-name> bash
```

This drops you into the container's filesystem. From here you can:

- Check if config files exist and have the right contents
- Test network connectivity (`wget`, `curl`, or `nc` if available)
- Inspect environment variables with `env` or `printenv`
- Check the process list with `ps aux`

Type `exit` to leave the container shell. Nothing you do inside the shell persists across container restarts (unless you write to a mounted volume).

### Checking environment variables

```bash
# Print all environment variables inside a container
docker exec <container-name> printenv

# Check a specific variable
docker exec <container-name> printenv MONGODB_URI
```

This is the fastest way to verify that Coolify injected the right environment variables. If a variable is missing or has the wrong value, update it in the Coolify app settings and redeploy.

### Inspecting container configuration

```bash
# Show full container config (networks, mounts, env vars, ports, etc.)
docker inspect <container-name>

# Show just the network settings
docker inspect --format '{{json .NetworkSettings.Networks}}' <container-name> | python3 -m json.tool

# Show just the mounted volumes
docker inspect --format '{{json .Mounts}}' <container-name> | python3 -m json.tool
```

`docker inspect` returns a large JSON document with everything Docker knows about the container. The `--format` flag with Go templates lets you extract specific sections. This is useful for checking which Docker network a container is on and what IP address it was assigned.

### Debugging container networking

```bash
# List all Docker networks
docker network ls

# Show which containers are on a specific network and their IPs
docker network inspect <network-name>
```

If one container cannot reach another, check that they are on the same Docker network. Coolify typically creates a network per project. You can also test connectivity from inside a container:

```bash
# Shell into the frontend container and test if it can reach the backend
docker exec -it <frontend-container> sh
wget -qO- http://<backend-container-name>:3000/api/health
```

If the backend's internal hostname is unknown, find it with `docker network inspect` — it lists every container on that network with its IP and aliases.

### Monitoring resource usage

```bash
# Live view of CPU, memory, and network usage per container
docker stats

# One-time snapshot (non-interactive)
docker stats --no-stream
```

If a container is using 100% of its memory limit, it may be getting OOM-killed (killed by the operating system for using too much memory) and restarting. Coolify lets you set memory limits per app — increase them if the container is consistently hitting the ceiling.

### Checking data persistence (volumes)

```bash
# List all Docker volumes
docker volume ls

# Show where a volume is stored on disk
docker volume inspect <volume-name>
```

Volumes persist data across container restarts. If your MongoDB data disappears after a redeploy, check that the volume is correctly attached. If a volume exists but seems empty, the container might be writing to a different path — verify with `docker inspect` on the container to see its mount configuration.

### Copying files in/out of containers

```bash
# Copy a file from inside a container to your local machine
docker cp <container-name>:/path/in/container ./local-path

# Copy a local file into a running container
docker cp ./local-file <container-name>:/path/in/container
```

Useful for extracting log files, database dumps, or configuration files for inspection.

### Connecting to MongoDB inside Docker

```bash
# Local development
docker compose exec mongo mongosh tiao

# Production (if you have SSH access to the host)
docker exec -it <mongo-container-name> mongosh tiao
```

See the [Admin section in the API reference](API.md#managing-admin-and-badges-via-mongosh) for common database queries.

### Further reading

- [Docker CLI reference](https://docs.docker.com/reference/cli/docker/) — complete command reference
- [Docker Compose CLI reference](https://docs.docker.com/reference/cli/docker/compose/) — multi-container orchestration
- [Docker networking overview](https://docs.docker.com/engine/network/) — how containers communicate
- [Docker volumes](https://docs.docker.com/engine/storage/volumes/) — persistent data storage
- [Coolify documentation](https://coolify.io/docs/) — Coolify-specific deployment concepts
- [Coolify troubleshooting](https://coolify.io/docs/knowledge-base/faq) — common Coolify issues

---

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
