FROM node:24.14.1-bookworm-slim AS deps
WORKDIR /app

RUN npm install -g pnpm@10.33.2

COPY server/package.json server/pnpm-lock.yaml server/

RUN pnpm --dir server install --frozen-lockfile

FROM deps AS build
WORKDIR /app

COPY shared ./shared
COPY server ./server

RUN pnpm --dir server run build
RUN pnpm --dir server install --prod --frozen-lockfile --ignore-scripts

FROM node:24.14.1-bookworm-slim AS runtime
WORKDIR /app/server

# curl for Coolify's health check. Coolify probes the container by
# running `curl … || wget … || exit 1` INSIDE it, in place of any
# HEALTHCHECK here, and bookworm-slim ships neither. Without one the
# probe can never pass and every deploy is rolled back. With it, a
# deploy is a rolling update: the old container serves until this one
# is healthy.
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=3000

COPY --from=build /app/server/package*.json ./
COPY --from=build /app/server/node_modules ./node_modules
COPY --from=build /app/server/dist ./dist

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=5 CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || '3000') + '/api/health').then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1))"

CMD ["node", "dist/server/index.js"]
