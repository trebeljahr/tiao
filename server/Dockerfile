FROM node:24.22.1-bookworm-slim AS deps
WORKDIR /app

RUN npm install -g pnpm@10.33.2

COPY server/package.json server/pnpm-lock.yaml server/

RUN pnpm --dir server install --frozen-lockfile

FROM deps AS build
WORKDIR /app

COPY shared ./shared
COPY server ./server

RUN pnpm --dir server run build
# Test the Linux/native dependency closure before removing dev dependencies or
# publishing the runtime image. Fixtures use no production credentials.
RUN cd /app/server && NODE_ENV=test \
    TOKEN_SECRET=synthetic-image-tests \
    MONGODB_URI=mongodb://127.0.0.1:9/synthetic-image-tests \
    S3_BUCKET_NAME=synthetic-image-tests \
    S3_PUBLIC_URL=https://assets.example.invalid \
    AWS_ACCESS_KEY_ID=synthetic AWS_SECRET_ACCESS_KEY=synthetic \
    AWS_REGION=eu-central-1 \
    node --test --test-concurrency=2 dist/server/tests/*.test.js
RUN pnpm --dir server install --prod --frozen-lockfile --ignore-scripts

FROM node:24.22.1-bookworm-slim AS runtime
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
# Fonts for the link-preview images (lib/previewImage.ts).
COPY --from=build /app/server/assets ./assets

# Full commit SHA, reported by /health as `build`. Last, so a new commit
# does not invalidate the cached layers above.
ARG BUILD_COMMIT
ENV BUILD_COMMIT=${BUILD_COMMIT}

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=5 CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || '3000') + '/api/health').then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1))"

CMD ["node", "dist/server/index.js"]
