#!/bin/sh
# Orchestrates both client and server for preview environments.
# The preview system sets PORT for the client; we derive the API port from it.

CLIENT_PORT="${PORT:-3000}"
API_PORT=$((CLIENT_PORT + 1))

export PORT="$CLIENT_PORT"
export API_PORT

exec npx concurrently -k -n client,server -c yellow,cyan \
  "PORT=$CLIENT_PORT API_PORT=$API_PORT npm --prefix client run dev" \
  "PORT=$API_PORT npm --prefix server run dev"
