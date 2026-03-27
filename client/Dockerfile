FROM node:22.20.0-bookworm-slim AS build
WORKDIR /app

COPY client/package*.json client/

RUN npm --prefix client ci

COPY shared ./shared
COPY client ./client

RUN npm --prefix client run build

FROM node:22.20.0-bookworm-slim AS runtime
WORKDIR /app

COPY --from=build /app/client/.next ./.next
COPY --from=build /app/client/public ./public
COPY --from=build /app/client/package*.json ./
COPY --from=build /app/client/next.config.mjs ./
COPY --from=build /app/client/node_modules ./node_modules

ENV NODE_ENV=production
ENV PORT=80

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=5 \
  CMD wget -q -O /dev/null http://127.0.0.1:80/ || exit 1

CMD ["npx", "next", "start", "-p", "80"]
