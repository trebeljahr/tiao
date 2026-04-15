---
sidebar_position: 6
title: Deployment
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
