#!/usr/bin/env bash
set -euo pipefail

CONTAINER_NAME="tiao-e2e-mongo"
MONGO_PORT="${E2E_MONGO_PORT:-27018}"

# Skip container management in CI (GitHub Actions provides the service)
if [ "${CI:-}" != "true" ]; then
  # Start MongoDB container if not already running
  if ! docker inspect -f '{{.State.Running}}' "$CONTAINER_NAME" 2>/dev/null | grep -q true; then
    docker rm -f "$CONTAINER_NAME" 2>/dev/null || true
    echo "[e2e] Starting MongoDB container on port $MONGO_PORT..."
    docker run -d --name "$CONTAINER_NAME" -p "$MONGO_PORT:27017" --tmpfs /data/db mongo:7
  else
    echo "[e2e] MongoDB container already running."
  fi

  # Wait for MongoDB to be ready
  echo "[e2e] Waiting for MongoDB..."
  for i in $(seq 1 30); do
    if node -e "
      const { MongoClient } = require('mongodb');
      const c = new MongoClient('mongodb://127.0.0.1:$MONGO_PORT', { serverSelectionTimeoutMS: 1000 });
      c.connect().then(() => c.db('admin').command({ ping: 1 })).then(() => { c.close(); process.exit(0); }).catch(() => process.exit(1));
    " 2>/dev/null; then
      echo "[e2e] MongoDB is ready."
      break
    fi
    sleep 1
  done
fi

# Start the server
exec npm run server
