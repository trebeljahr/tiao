FROM node:22.20.0-bookworm-slim AS build
WORKDIR /app

COPY client/package*.json client/

RUN npm --prefix client ci

COPY package.json ./
COPY shared ./shared
COPY client ./client

ARG API_URL=http://127.0.0.1:5005
ENV API_URL=$API_URL

RUN npm --prefix client run build

FROM node:22.20.0-bookworm-slim AS runtime
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

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=5 \
  CMD node -e "require('http').get('http://127.0.0.1:80/',r=>{process.exit(r.statusCode<400?0:1)}).on('error',()=>process.exit(1))"

CMD ["node", "server.mjs"]
