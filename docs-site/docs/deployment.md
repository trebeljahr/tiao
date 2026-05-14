---
sidebar_position: 6
title: Deployment
description: Production deployment notes for Tiao on Coolify, including frontend and backend containers, routing, environment variables, and operations.
---

# Tiao On Coolify

Tiao is now set up to deploy as two applications:

- a frontend container built from `client/Dockerfile`
- a backend container built from `server/Dockerfile`

The recommended production shape still keeps a single browser origin:

- the frontend serves the Next.js application via a Node.js server
- either the frontend proxies `/api` and `/api/ws` to the backend over the private network, or Coolify path-routes those same paths directly to the backend
- the backend does not serve frontend assets anymore

## Recommended production shape

Use two [Coolify applications](https://coolify.io/docs/applications) built from this repo:

- `tiao-client`: public, built from `client/Dockerfile`
- `tiao-server`: internal or public as needed, built from `server/Dockerfile`

Recommended dependencies:

- MongoDB: external managed MongoDB, or a [Coolify MongoDB resource](https://coolify.io/docs/resources/databases)
- Object storage: S3, Cloudflare R2, Hetzner Object Storage, or MinIO
- **Redis (required)**: backs matchmaking, distributed locks, rate limiting, and cross-instance broadcasts. The server refuses to start without `REDIS_URL`. A single Redis container is plenty for any realistic Tiao deployment — colocate it with MongoDB on a "data tier" box.

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

Start from `server/.env.example`.

Required:

- `MONGODB_URI`
- `TOKEN_SECRET`
- `REDIS_URL` -- backs matchmaking, distributed locks, rate limiting, and cross-instance broadcasts. The server refuses to start without it (outside `NODE_ENV=test`).
- `S3_BUCKET_NAME`
- `S3_PUBLIC_URL` or `CLOUDFRONT_URL`
- `AWS_REGION`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`

Optional:

- `FRONTEND_URL`
- `S3_ENDPOINT`
- `S3_FORCE_PATH_STYLE`
- `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` -- GitHub OAuth
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` -- Google OAuth
- `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` -- Discord OAuth
- `BETTER_AUTH_URL` -- custom auth base URL (falls back to `FRONTEND_URL`)
- `BETTER_AUTH_SECRET` -- auth signing secret (falls back to `TOKEN_SECRET`)

Notes:

- the backend `FRONTEND_URL` should be the public frontend URL — it is used for CORS and as the better-auth base URL
- `S3_ENDPOINT` and `S3_FORCE_PATH_STYLE=true` are useful for MinIO and some S3-compatible providers.

Frontend runtime variables:

- `BACKEND_UPSTREAM=http://tiao-server:3000`

Notes:

- `BACKEND_UPSTREAM` is only needed in frontend-proxy mode
- if you use Coolify path-based routing on the same public domain for `/api` and `/api/ws`, the frontend app can leave `BACKEND_UPSTREAM` unset
- `REDIS_URL` is a **backend** variable (listed in the Required section above), not a frontend variable — the Next.js client never talks to Redis directly

Recommended values for a first production deploy:

- `FRONTEND_URL=https://your-domain-example.com`
- `MONGODB_URI=<Coolify Mongo internal URL or managed Mongo URL>`
- `REDIS_URL=redis://<coolify-internal-redis-host>:6379`
- `PORT=3000` or simply omit `PORT` and let the backend default to `3000`
- `BACKEND_UPSTREAM=http://<coolify-internal-backend-host>:3000`

Recommended values for a single-domain Coolify path-routing deploy:

- frontend domain: `https://your-domain-example.com`
- backend domains: `https://your-domain-example.com/api,https://your-domain-example.com/api/ws`
- `FRONTEND_URL=https://your-domain-example.com`
- `REDIS_URL=redis://<coolify-internal-redis-host>:6379`
- backend `PORT=3000` or omit it
- no extra public backend hostname is required

## Step-By-Step First Deploy

1. Push the Tiao repo to GitHub.
2. Let GitHub Actions build and publish both `ghcr.io/<owner>/<repo>-client:main` and `ghcr.io/<owner>/<repo>-server:main`.
3. In Coolify, add GHCR as a registry if the images are private.
4. In Coolify, create a MongoDB resource in the same project and environment as Tiao.
5. Deploy the MongoDB resource.
6. Copy the MongoDB resource's internal connection string.
7. In Coolify, create a Redis resource in the same project and environment.
8. Deploy the Redis resource and copy its internal connection string.
9. Create a new backend application of type `Docker Image`.
10. Point it at `ghcr.io/<owner>/<repo>-server:main`.
11. Set the backend port to the same value that you put in the environment variables for `PORT`
12. Set the backend health check path to `/api/health`.
13. Add backend runtime environment variables from `server/.env.example`.
14. Replace `MONGODB_URI` with the Coolify Mongo internal URL, not `localhost`.
15. Set `REDIS_URL` to the Coolify Redis internal URL — the backend refuses to start without it.
16. Set `FRONTEND_URL` to the eventual public frontend URL.
17. Deploy the backend once and confirm `/api/health` is healthy.
18. Create a new frontend application of type `Docker Image`.
19. Point it at `ghcr.io/<owner>/<repo>-client:main`.
20. Set the frontend port to `80`.
21. Set the frontend health check path to `/healthz`.
22. Attach the public domain, for example `https://your-domain-example.com`.
23. Set `BACKEND_UPSTREAM` to the backend app's internal URL, for example `http://tiao-server:3000`.
24. Deploy the frontend once and confirm the site loads at the public domain.
25. After the first successful deploy, keep using the GitHub Actions workflow for ongoing redeploys.

## DNS / Proxy Notes

See [Coolify DNS configuration](https://coolify.io/docs/knowledge-base/dns-configuration) for domain setup details.

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

See the [Coolify API reference](https://coolify.io/docs/api-reference) for full details.

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

### Deployed changes not showing up in production

If you pushed to `main`, the GitHub Actions workflow succeeded, and the Coolify deploy API returned a success response — but prod is still running old code:

1. **Check what image the running container is using:**

   ```bash
   docker inspect <container-name> --format '{{.Image}}'
   ```

2. **Check what image GHCR has for the `:main` tag:**

   ```bash
   docker manifest inspect ghcr.io/<owner>/<repo>-client:main
   ```

3. **Compare the digests.** If they don't match, Coolify restarted the container with a stale cached image instead of pulling the new one. This is a [known Coolify issue](https://github.com/coollabsio/coolify/issues/5318) — the deploy API queues a redeploy but does not always pull the latest image.

4. **Verify the image creation date on the server:**

   ```bash
   docker images ghcr.io/<owner>/<repo>-client:main --format '{{.CreatedAt}}'
   ```

   If the timestamp is older than the latest GitHub Actions run, the server has a stale image.

**Immediate fix:** In the Coolify UI, find the resource and use **"Pull latest images and restart"** (under the Advanced/Restart menu).

**Permanent fix:** This is a known limitation of Coolify's deploy API — it does not guarantee an image pull. If this keeps happening, consider switching to a Docker Compose deployment where you control `docker compose pull && docker compose up -d` directly.

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

See the [API reference](/docs/api-reference/tiao-api) for common database admin queries (granting badges, making users admin).

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

## Documentation Site

The documentation site (this site) is deployed separately from the app via **GitHub Pages**. It does not use Coolify.

### How it works

A GitHub Actions workflow (`.github/workflows/docs.yml`) runs on every push to `main` that touches `docs/`, `docs-site/`, `shared/src/`, or `server/routes/`. The pipeline:

1. Installs server and docs-site dependencies
2. Generates the OpenAPI spec from server route annotations (`npx tsx server/scripts/generate-openapi.ts`)
3. Generates API reference pages from the spec (`npm --prefix docs-site run generate:api-docs`)
4. Builds the Docusaurus site (`npm --prefix docs-site run build`)
5. Deploys to GitHub Pages via `actions/deploy-pages`

The docs site is available at `https://docs.your-domain-example.com`.

### When docs are rebuilt

The workflow triggers when any of these paths change:

- `docs/**` — markdown source
- `docs-site/**` — Docusaurus config, CSS, plugins
- `shared/src/**` — game engine (source links may change)
- `server/routes/**` — API routes (OpenAPI spec may change)

### Custom domain

The docs domain (`docs.your-domain-example.com`) is configured as a GitHub Pages custom domain. DNS points a CNAME to the GitHub Pages URL.

## Realtime Limitation

Matchmaking, distributed locks, rate limit counters, and cross-instance broadcasts all run through Redis (`REDIS_URL` is required). What still lives **per backend process**, in memory, is the actual WebSocket socket map (`gameService.ts` `connections` / `lobbyConnections` / `socketRooms`) and the game-tick timers.

Practical implication for scaling: you can run multiple `tiao-server` replicas as long as a given player's WebSocket session stays pinned to one replica for the lifetime of the connection. That's already how it works in practice — the browser opens one WS, gets routed by Traefik to one backend, and stays on it until disconnect. When the connection drops the client reconnects (`useMultiplayerGame.ts`) and may land on a different replica, which is fine: the new replica reads game state from Mongo / Redis. So horizontal backend scaling works, but full Redis Pub/Sub WebSocket fan-out (where ANY replica can push to ANY player) is not yet a thing — that's a future enhancement.

Deploys are graceful (Coolify rolls containers one at a time), but active matches will briefly reconnect when the replica they're pinned to is replaced.

## Scaling and Multi-Node Topology

This section is mostly for future reference. The current production deployment is Phase 0 below — one Hetzner VPS, all containers on one Docker daemon — and that's the right shape until something forces you off of it. Each phase below describes the next step and the actual decision trigger for taking it. Don't skip phases. Each phase's complexity buys a specific kind of resilience, and adding all of it at once means you can't tell which piece is responsible when something breaks.

### Phase 0: one Hetzner box (current shape)

What runs on the box:

- **Coolify control plane** — the dashboard, API, and background workers
- **`tiao-client`** container — Next.js custom server, port 80
- **`tiao-server`** container — Express + WebSocket, port 3000
- **MongoDB** — Coolify resource
- **Redis** — Coolify resource (required since the server stopped falling back to in-memory mode)

Browser → Cloudflare → Coolify Traefik → `tiao-client:80`. The Next.js custom server proxies `/api/*` and `/ws/*` to `BACKEND_UPSTREAM=http://tiao-server:3000` over Docker's internal bridge network — both containers share one Docker daemon, so the hostname `tiao-server` resolves via Docker's built-in DNS. Zero network hops outside the box.

This is the right shape for a hobby project. Every container is one `docker logs` away. There is one failure boundary (the box) instead of N. **Don't move off this until something actually forces you to.**

### Coolify across multiple Hetzner boxes

When you do outgrow Phase 0, here's the model: Coolify's multi-server feature lets you connect additional Linux hosts to one Coolify dashboard via SSH. The thing to internalize is that **Coolify itself is single-control-plane**:

- The dashboard / API / background workers run on ONE box (the "main" Coolify install).
- Other boxes are added under Servers → Add Server, connected via SSH key.
- Coolify SSHes into the remote boxes and runs `docker` commands directly. There is no Coolify daemon on the remote box — just Docker, sshd, and a Coolify-managed Traefik instance.

So:

> **N Hetzner boxes = N Docker daemons = N Coolify "Server" entries = 1 Coolify control plane.**

You don't run Coolify-the-app on the other boxes; only one of them is the Coolify host, the rest are passive Docker hosts the control plane orchestrates remotely.

Each box gets its own Traefik instance with its own Cloudflare-fronted certs.

**Cloudflare wildcard cert constraint.** Cloudflare's free Universal SSL issues only single-level wildcard certs — `*.example.com` works, `*.api.example.com` does not. If you're using Universal SSL (the default), all Tiao subdomains have to be flat: `tiao.example.com`, `tiao-api.example.com`, `tiao-redis.example.com` — not nested ones like `api.tiao.example.com`. Cloudflare's paid Advanced Certificate Manager can issue deeper wildcards if you ever need them.

### Cross-box networking

Containers on different Coolify Servers can NOT see each other via Docker network names — different Docker daemons, no shared network unless you set up Swarm. Cross-box communication needs one of these, in order of preference for Tiao:

1. **Hetzner Cloud private network** — free, in-region, ~0.1 ms latency. Create a network in the Hetzner console, attach all your boxes to it. Each box gets a stable `10.x.x.x` address. Set `BACKEND_UPSTREAM=http://10.0.0.5:3000` and `tiao-client` on box A reaches `tiao-server` on box B without going through the public internet, Cloudflare, or Traefik. **This is the right answer 95% of the time.** The only constraint: same Hetzner datacenter region (FSN1, NBG1, HEL1, etc. — each region is its own private-network domain).
2. **Public hostname per service** — each app gets its own Coolify-managed subdomain → Traefik on the host that runs it → the container. Backend becomes `https://tiao-api.example.com`, frontend's `BACKEND_UPSTREAM` is set to that. Adds ~5 ms TLS handshake plus an extra hop. Works across regions. The proxy code in `client/server.mjs` doesn't care — `BACKEND_UPSTREAM` is just a URL.
3. **Docker Swarm** — Coolify supports it. Lets you treat N boxes as one cluster with overlay networking. Heavyweight, somewhat experimental in Coolify, and adds complexity Tiao does not need. Skip unless you actually need cluster scheduling.

### Scaling the Next.js client tier

`client/server.mjs` is **fully stateless** — a pure proxy + static-file server with zero in-memory caches, no session state, no sticky-routing requirement. Adding a second `tiao-client` replica is free:

- Coolify's Traefik load-balances between `tiao-client-1:80` and `tiao-client-2:80`
- Both proxy requests to the same backend independently
- No synchronization or state sharing needed between client replicas
- Auth cookies (HttpOnly, issued by the backend) remain valid across all client instances
- WebSocket clients can land on a different client replica on reconnect without consequence — the actual WebSocket state lives on `tiao-server` (see Realtime Limitation above), and the new client replica just opens a fresh upgrade-proxy to whichever backend is alive

Where horizontal client scaling actually helps: zero-downtime rolling deploys (Coolify can replace one replica at a time without a brief outage gap) and hedging against a single frontend box dying. For raw throughput, the bottleneck is `tiao-server`, not Next.js — a single client replica handles way more than Tiao will ever need.

### Scaling the backend tier

The backend tier scales horizontally via Redis-backed shared state. See **Realtime Limitation** above for the specifics: matchmaking, locks, rate limiting, and cross-instance broadcasts go through Redis; WebSocket sockets and game timers stay per-process; sticky routing happens naturally via Traefik for the lifetime of one WS connection. Multiple `tiao-server` replicas all coordinate through one Redis instance.

`npm run dev:parallel` exercises this exact path locally — N backends connected to one local Redis, two browser profiles playing each other across instances. If it works in `dev:parallel`, it works in production multi-replica.

### Redis placement

Redis is single-instance for any realistic Tiao deployment. One container, one box. **The right place to put it is the same box that runs Mongo** — treat Mongo + Redis as the "data tier":

- Both are stateful
- Both want fast disk
- Both want backups
- Both have a similar failure-domain blast radius

Concentrating them gives you one well-defined "data box" to babysit (snapshots, monitoring, restore drills) and N stateless "app boxes" that are trivial to replace.

When you go multi-box, the topology becomes:

```
                          Cloudflare
                              │
                              ▼
        ┌───────────── Box A (app tier) ─────────────┐
        │  tiao-client × N  →  tiao-server × N       │
        └────────────┬────────────────┬──────────────┘
                     │                │
                     ▼                ▼
              ┌── Box B (data tier) ──┐
              │  Mongo  +  Redis      │
              │  (Hetzner private net)│
              └───────────────────────┘
```

The app-tier boxes scale horizontally. The data-tier box stays one machine. Both `BACKEND_UPSTREAM` (for `tiao-client` → `tiao-server`) and `REDIS_URL` / `MONGODB_URI` (for `tiao-server` → data tier) get set to private network IPs.

**HA Redis options**, if you ever need them:

- **Redis Sentinel** — 3 Redis nodes with automatic failover. Coolify doesn't have a built-in template, but you can deploy via compose.
- **Hosted Redis** (Upstash, Redis Cloud, etc.) — outsource the resilience. Probably the right answer if you reach that point.
- **Just accept the SPOF and have alerts** — probably what Tiao should do for the foreseeable future.

### Failure states

Failure modes worth thinking through, with mitigations:

| What dies                        | Effect                                                                                                                                      | Mitigation                                                                                                                                            |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Single Hetzner box (Phase 0)** | Total outage                                                                                                                                | Daily snapshots + alerts + manual restore. Don't pretend you have HA when you don't.                                                                  |
| **Redis**                        | Backend refuses to start; running multi-instance backends stop cross-broadcasting (a player on backend 1 stops seeing moves from backend 2) | Single Redis instance + monitoring. Restore from RDB snapshot on failure. Hosted Redis if you ever care about Redis-specific HA.                      |
| **MongoDB**                      | Auth fails (better-auth sessions live in Mongo), persistence fails, full outage                                                             | Daily snapshots to S3/R2. Mongo replica set when you actually have users to lose — see Scaling MongoDB below.                                         |
| **Backend box (multi-box era)**  | `tiao-client` gets ECONNREFUSED on `BACKEND_UPSTREAM` → users see 502                                                                       | Run ≥2 backend replicas behind Traefik. Each replica's WebSocket state is local but Redis covers the cross-instance gap.                              |
| **Frontend box (multi-box era)** | Traefik can't reach `tiao-client` → 502 from Cloudflare's "no available server" page                                                        | Run ≥2 frontend replicas. Trivially safe because they're stateless.                                                                                   |
| **Coolify control plane box**    | Existing containers on remote boxes keep running; you can't deploy or change settings until it's back                                       | Don't put critical services on the control plane box if you want maintenance-window-free control plane work. In practice: fine, just fix it manually. |
| **Hetzner private network blip** | Backend can't reach Mongo / Redis → cascading errors                                                                                        | Hetzner private networks are very reliable in-region. If you're paranoid, monitor Mongo/Redis ping from each app box and page on sustained loss.      |
| **Cloudflare outage**            | Site unreachable to most of the world                                                                                                       | Accept it. Cloudflare outages are global news; nothing you can do unless you go DNS-only or multi-edge.                                               |

### A pragmatic scaling roadmap

In order, with the actual decision trigger for each step:

1. **Phase 0 (current)** — one Hetzner box, everything on it. Single failure boundary, simple to reason about, easy to debug. **Trigger to leave**: sustained CPU pressure, RAM exhaustion, or you've outgrown the biggest single Hetzner instance you're willing to pay for.
2. **Phase 1: data tier split** — two boxes. Box A runs the app tier (`tiao-client` + `tiao-server`), Box B runs the data tier (Mongo + Redis). Connect via Hetzner private network. Same `BACKEND_UPSTREAM` shape, just `MONGODB_URI` and `REDIS_URL` now point at Box B's `10.x.x.x` addresses. **Trigger**: Mongo IO contention with the app processes, or a Mongo restart taking the app processes down with it.
3. **Phase 2: app tier replicas** — run ≥2 `tiao-server` replicas, ideally on separate boxes for blast-radius reasons. Both connect to Box B's Redis + Mongo. Traefik load-balances the frontends; sticky routing for WebSocket sessions happens naturally because each WS stays pinned to its initial replica until disconnect. **Trigger**: rolling deploys are taking you down for too long, or you're CPU-bound on a single backend.
4. **Phase 3: HA data tier** — Mongo replica set (3 nodes) + Redis Sentinel (3 nodes), or move both to hosted offerings. **Trigger**: you actually have users complaining about outages, OR you want zero-downtime version upgrades on Mongo. See Scaling MongoDB below for the full Mongo-side story.

For Tiao, **Phase 0 is fine indefinitely**. Phase 1 is a nice mid-point. Beyond that is over-engineering for a hobby game unless it gets unexpectedly popular.

## Scaling MongoDB

Mongo is the hardest piece of the stack to grow — but the good news is **you almost certainly never need to**. Tiao's Mongo workload is small even by hobby-game standards. This section lays out the realistic options and when each starts to make sense, so future-you doesn't have to re-derive it under pressure.

### What Mongo is doing for Tiao

The hot paths, ranked by frequency:

1. **Game room writes** — `gameService.saveRoom()` after every move. About one small document upsert per move per active game. A typical game has ~50 moves; 100 concurrent games is ~5,000 writes/min. A single Mongo instance handles this in its sleep — under 5% CPU on a small VPS.
2. **Player profile reads** — every page load, every authenticated API call. Cached in the client's `useAuth` and the server's `playerSessionStore`, so they're not as hot as they look. Tiny indexed lookups.
3. **better-auth session reads** — every authenticated request hits the `session` collection. Indexed lookup by session token.
4. **Tournament writes** — small bursts when matches finish.
5. **Achievement writes** — small bursts on milestone events.

The working set (data that needs to be in RAM for fast reads) is dominated by active game rooms plus active sessions — a few hundred MB even at thousands of concurrent users. **Mongo loves RAM**, and a 4 GB box with the working set fully in memory will out-perform a 32 GB box that's churning through disk.

The implication: scale Mongo **vertically** for a long, long time. Throw RAM at it. You'll outgrow the rest of the stack first.

### Phase 1: vertical scaling (current → ~10k MAU)

One Mongo instance, bigger box. Hetzner CCX series gives you up to 64 GB RAM for not much money. Backups go to Hetzner Object Storage / S3 daily. SPOF on the box, accept it, monitor it.

95% chance Tiao stops here forever.

### Phase 2: replica set (when you actually have users to lose)

Run 3 `mongod` instances — one primary plus two secondaries — across two or three Hetzner boxes. Mongo handles replication, election, and automatic failover natively; you point `MONGODB_URI` at all three nodes:

```
mongodb://node1,node2,node3/tiao?replicaSet=rs0
```

The driver figures out which is the primary at any given moment.

What you get:

- **HA**: any one node can die and the cluster automatically promotes a secondary to primary in ~10s. `MONGODB_URI` doesn't change.
- **Read scaling** (optional): you can route certain reads to secondaries by setting a read preference like `secondaryPreferred`. Useful for "show me a list of games" queries that can tolerate ~1-2s of staleness. Tiao currently doesn't lean on this but the hooks are there.
- **Effectively continuous backup**: secondaries are basically live backups. You can take point-in-time snapshots from one without affecting the primary.

What it costs:

- 3× the hosting bill
- Operational complexity: oplog tailing, election storms, network partitions, version upgrades that have to be rolling
- A few subtle code patterns: don't write then immediately read with `secondaryPreferred` (you'll see stale data); make sure write concern is `majority` for anything you can't lose

For Tiao specifically, the most realistic Phase 2 trigger isn't traffic — it's **"I'm about to do a Mongo version upgrade and I don't want a maintenance window"**. A replica set lets you do a rolling upgrade with zero downtime. Vertical scaling means a maintenance window every time.

### Phase 3: sharding (probably never)

Sharding partitions data across multiple primaries by a "shard key", so writes scale roughly linearly with the number of shards. Each shard is itself a replica set, so you also keep HA. Sharded clusters need extra moving parts (a 3-node config server replica set + a `mongos` query router on every backend box), shard key choice is hard to reverse, and rebalancing is operationally painful.

Shard when:

- A single primary can't keep up with writes (>50k writes/sec sustained, in Tiao terms: hundreds of thousands of concurrent games)
- The working set genuinely doesn't fit in RAM on the biggest available box
- You need to colocate data near users in different regions

For Tiao at hobby/indie scale: don't even think about it. If Tiao gets that big, you'll have other (better) problems to solve first, including hiring someone to operate it.

### Phase 0.5: hosted Mongo (the easy button)

Mongo Atlas (or whichever managed-Mongo offering exists at the time you read this) outsources all the operational pain. M10 Atlas (~$60/mo as of 2026) gives you a 3-node replica set, automatic backups, point-in-time recovery, monitoring, and one-click version upgrades. Compared to self-hosting: more expensive per RAM-hour, but the ops time savings are massive. Worth it the moment you have any real users whose data you care about losing.

### What to actually do, in order

1. **Right now**: make sure Mongo is being snapshotted daily to S3/R2 with at least 7 days of retention. That's the entire HA story for a hobby project. Do a restore drill once a quarter so you know the snapshots actually work.
2. **When `tiao-server` starts feeling slow on Mongo queries**: check if it's a missing index. Look at the slow query log. Add an index (`createIndex` on the hot fields). 95% of "Mongo is slow" turns out to be a missing index, not a scaling problem.
3. **When you legitimately have enough users that a 2-hour outage hurts**: move to Mongo Atlas. Skip the self-hosted replica set unless you specifically want the learning experience or you have a strong cost reason.
4. **When you're growing past Atlas M10**: vertical-scale within Atlas. M20, M30, etc. Each tier gives more RAM + storage. Same `MONGODB_URI`, just more resources behind it.
5. **Sharding**: ignore until forced.

### What matters more than scaling

For the next several years the thing that will actually kill Tiao is **not a scaling failure**. It's a corrupted disk with no usable backup, or a botched migration that drops a collection.

Game-history records — finished games, tournament results, achievements — are the irreplaceable bits. If you lose the active matchmaking queue in a Redis outage, players reconnect and re-queue, no real harm. If you lose the `gameRooms` collection in Mongo, you've lost player history forever. So:

- Prioritize backup quality and restore drills over scaling architecture.
- The current single-instance Mongo will outlast your scaling concerns.
- Run a real restore from your backups every quarter. If you've never tested the restore path, you don't have backups — you have hope.
