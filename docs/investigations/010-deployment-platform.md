# Investigation: Deployment Platform

**Status:** Decided
**Date:** 2025-2026

## Context

The game needs a deployment platform that supports Docker containers, custom domains, SSL, and is affordable for a side project. Self-hosting is preferred for control and cost.

## Options Considered

### Vercel

- Excellent Next.js support (they maintain it)
- Serverless model doesn't work for persistent WebSocket connections
- Free tier is generous for static/SSR but WebSocket support requires Enterprise or workarounds
- Vendor lock-in for deployment model

### Railway / Render / Fly.io

- Container-based platforms with WebSocket support
- Monthly costs scale with usage ($5-20+/month)
- Less control than a VPS
- Good DX but another managed service dependency

### Coolify on Hetzner VPS (chosen)

- Open-source, self-hosted PaaS (alternative to Heroku/Vercel)
- Runs on a Hetzner VPS (~$5-10/month for a capable box)
- Full Docker container support with automatic SSL via Let's Encrypt
- GitHub integration for automated deployments
- Complete control over infrastructure
- Can run MongoDB, Redis, MinIO, and the app on the same box

### Bare Docker on VPS (no PaaS)

- Maximum control, minimum abstraction
- Manual SSL, deployment scripts, monitoring
- More operational overhead than Coolify provides

## Outcome

Coolify on Hetzner VPS was chosen. The deployment architecture uses:

- Two Docker containers: client (Next.js via custom server.mjs) and server (Node.js Express)
- GitHub Actions builds images to GHCR, triggers Coolify redeploy via API
- MongoDB and Redis run as Coolify services on the same VPS
- Automatic SSL and reverse proxy via Coolify's built-in Traefik

The key advantage is cost (~$5-10/month total) with full control. The tradeoff is operational responsibility for the VPS (updates, monitoring, backups), which is acceptable for a side project.
