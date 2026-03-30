# Plan: Add Admin/Badge Docs + Docker Troubleshooting Guide

## Context

Two additions requested:

1. Document the admin badge system with mongosh commands for granting badges and making users admin
2. Add a Docker troubleshooting section to the Coolify deployment doc with common debugging commands, explanations for Docker newcomers, and links to further reading

## Changes

### 1. docs/API.md — Expand the Admin section

Add a subsection under Admin that details:

- The badge system overview (13 known badges, 3 tiers)
- How admin status works (`isAdmin: true` on GameAccount)
- mongosh commands to:
  - Connect to local dev MongoDB (`docker compose exec mongo mongosh`)
  - Find a user by username
  - Grant admin privileges
  - Grant/revoke badges directly in the DB
  - Check a user's badges and admin status

### 2. docs/coolify-deployment.md — Add Docker Debugging section

Insert a new section before or after the existing Troubleshooting section with:

- `docker ps` — list running containers
- `docker logs <container>` — view container output
- `docker exec -it <container> sh` — shell into a container
- `docker inspect <container>` — check config, networking, mounts
- `docker network ls` / `docker network inspect` — check container networking (why containers can't reach each other)
- `docker compose logs` — view all service output at once
- `docker stats` — monitor resource usage
- `docker volume ls` / `docker volume inspect` — check data persistence
- Explain Coolify's Docker network model (containers communicate via internal Docker network names, not localhost)
- Links to Docker docs, Docker Compose docs, Coolify docs

### 3. docs-site/docs/deployment.md — Mirror the Docker debugging section

Keep in sync with docs/coolify-deployment.md.

## Files to modify

- `docs/API.md` — add admin/badge detail section with mongosh commands
- `docs/coolify-deployment.md` — add Docker debugging guide section
- `docs-site/docs/deployment.md` — mirror Docker debugging section
