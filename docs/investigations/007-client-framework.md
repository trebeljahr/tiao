# Investigation: Client Framework (Vite SPA vs Next.js)

**Status:** Decided — see [ADR #10 (Vite to Next.js 14 App Router Migration)](../ARCHITECTURE_DECISIONS.md#10-vite-to-nextjs-14-app-router-migration)
**Date:** 2026-03-27

## Context

The client was originally a Vite-powered React SPA with react-router-dom. As the project grew (SEO needs, social sharing meta tags, server-side rendering for initial load performance), the limitations of a pure SPA became apparent.

## Options Considered

### Vite + React Router (original)

- Fast HMR, simple configuration, lightweight
- Pure client-side rendering — no SSR, no SEO, no social sharing previews
- Nginx serves static files in production
- Clean separation between client and server deployments

### Next.js 14 App Router (chosen)

- Server-side rendering for SEO and social sharing meta tags
- File-system based routing (replaces react-router-dom)
- Built-in image optimization, font optimization, metadata API
- Requires a Node.js runtime in production (not just static files)
- Larger deployment footprint

### Remix

- Similar SSR capabilities to Next.js
- Better data loading patterns (loaders/actions)
- Smaller community than Next.js
- Would be comparable effort to Next.js migration

## Migration Challenges

The migration (commit `f90bb618`) involved:

1. Replacing react-router-dom with Next.js `app/` directory routing
2. Renaming `src/pages/` to `src/views/` to avoid Next.js Pages Router conflict
3. Extracting auth state from `App.tsx` into `AuthContext` provider
4. Creating custom `server.mjs` with `http-proxy` for WebSocket proxying — needed because same-origin cookies don't work with cross-origin WebSocket connections
5. Converting all `VITE_*` env vars to `NEXT_PUBLIC_*`
6. Switching Dockerfile from Nginx static serving to `node server.mjs`
7. Changing SameSite cookie from `Strict` to `Lax` for navigation behavior under Next.js
8. Creating standalone `vitest.config.mts` (was previously embedded in `vite.config.mts`)

## Outcome

Next.js 14 App Router was adopted. The custom `server.mjs` wrapper for WebSocket proxying is the most notable architectural consequence — it adds a proxy layer but enables same-origin session cookies for WebSocket connections, which is critical for the auth model.
