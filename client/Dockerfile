FROM node:24.14.1-bookworm-slim AS build
WORKDIR /app

# ---------------------------------------------------------------------------
# Build-time args.
#
# CRITICAL: every `NEXT_PUBLIC_*` env var that the browser bundle needs must
# be declared here as an ARG, re-exported as ENV, and passed in at
# `docker build --build-arg NEXT_PUBLIC_FOO=bar`. Next.js replaces
# `process.env.NEXT_PUBLIC_FOO` references with the current value at
# `next build` time and bakes the result into the static JS. Runtime env
# on the container does NOT reach the already-compiled browser bundle —
# if you only set the var in Coolify's Runtime tab, the browser will see
# `undefined` forever.
#
# Add new vars here AND in Coolify's Build-time variables tab for the
# frontend service. See client/.env.example for the canonical list.
# ---------------------------------------------------------------------------

ARG APP_VERSION
ENV APP_VERSION=${APP_VERSION}

# OpenPanel — analytics client for the browser. Both CLIENT_ID and API_URL
# must be set at build time for the consent banner + web SDK to activate.
ARG NEXT_PUBLIC_OPENPANEL_CLIENT_ID
ARG NEXT_PUBLIC_OPENPANEL_API_URL
ARG NEXT_PUBLIC_OPENPANEL_ENABLE_IN_DEV
ENV NEXT_PUBLIC_OPENPANEL_CLIENT_ID=${NEXT_PUBLIC_OPENPANEL_CLIENT_ID}
ENV NEXT_PUBLIC_OPENPANEL_API_URL=${NEXT_PUBLIC_OPENPANEL_API_URL}
ENV NEXT_PUBLIC_OPENPANEL_ENABLE_IN_DEV=${NEXT_PUBLIC_OPENPANEL_ENABLE_IN_DEV}

# GlitchTip (Sentry-compatible) error monitoring — DSN inlined at build time.
ARG NEXT_PUBLIC_GLITCHTIP_DSN
ENV NEXT_PUBLIC_GLITCHTIP_DSN=${NEXT_PUBLIC_GLITCHTIP_DSN}

# Creator profile shortcuts — stable player IDs linked from the landing page.
# Optional: if unset, the creator pages fall back to a 404.
ARG NEXT_PUBLIC_CREATOR_RICO_ID
ARG NEXT_PUBLIC_CREATOR_ANDREAS_ID
ENV NEXT_PUBLIC_CREATOR_RICO_ID=${NEXT_PUBLIC_CREATOR_RICO_ID}
ENV NEXT_PUBLIC_CREATOR_ANDREAS_ID=${NEXT_PUBLIC_CREATOR_ANDREAS_ID}

# Direct-origin backend overrides. Only needed if the frontend shouldn't
# proxy /api and /ws through its own server (default deployment does).
ARG NEXT_PUBLIC_API_BASE_URL
ARG NEXT_PUBLIC_WS_URL
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}
ENV NEXT_PUBLIC_WS_URL=${NEXT_PUBLIC_WS_URL}

COPY client/package*.json client/

RUN npm --prefix client ci

COPY package.json ./
COPY shared ./shared
COPY client ./client

RUN npm --prefix client run build

FROM node:24.14.1-bookworm-slim AS runtime
WORKDIR /app

COPY --from=build /app/client/.next ./.next
COPY --from=build /app/client/public ./public
COPY --from=build /app/client/package*.json ./
COPY --from=build /app/client/next.config.mjs ./
COPY --from=build /app/client/server.mjs ./
COPY --from=build /app/client/node_modules ./node_modules
COPY --from=build /app/client/src/i18n ./src/i18n

ENV NODE_ENV=production
ENV PORT=80

# Runtime-only proxy targets (not baked into the JS bundle). The custom
# server.mjs reads these at startup to proxy analytics and error monitoring
# requests through the app's own origin, avoiding adblocker filters.
# OPENPANEL_PROXY_URL=https://analytics-api.trebeljahr.com
# GLITCHTIP_PROXY_URL=https://glitchtip.trebeljahr.com

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=5 \
  CMD node -e "require('http').get('http://127.0.0.1:80/',r=>{process.exit(r.statusCode<400?0:1)}).on('error',()=>process.exit(1))"

CMD ["node", "server.mjs"]
