FROM node:22.20.0-bookworm-slim AS deps
WORKDIR /app

COPY server/package*.json server/

RUN npm --prefix server ci

FROM deps AS build
WORKDIR /app

COPY shared ./shared
COPY server ./server

RUN npm --prefix server run build
RUN npm --prefix server prune --omit=dev

FROM node:22.20.0-bookworm-slim AS runtime
WORKDIR /app/server

ENV NODE_ENV=production
ENV PORT=3000

COPY --from=build /app/server/package*.json ./
COPY --from=build /app/server/node_modules ./node_modules
COPY --from=build /app/server/dist ./dist

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=5 CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || '3000') + '/api/health').then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1))"

CMD ["node", "dist/server/index.js"]
