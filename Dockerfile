FROM node:20-bookworm-slim AS deps
WORKDIR /app

COPY client/package*.json client/
COPY server/package*.json server/

RUN npm --prefix client ci
RUN npm --prefix server ci

FROM deps AS build
WORKDIR /app

COPY . .

RUN npm --prefix client run build
RUN npm --prefix server run build
RUN npm --prefix server prune --omit=dev

FROM node:20-bookworm-slim AS runtime
WORKDIR /app/server

ENV NODE_ENV=production
ENV PORT=3000

COPY --from=build /app/server/package*.json ./
COPY --from=build /app/server/node_modules ./node_modules
COPY --from=build /app/server/dist ./dist
COPY --from=build /app/client/build ../client/build

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=5 CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || '3000') + '/api/health').then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1))"

CMD ["node", "dist/server/index.js"]
