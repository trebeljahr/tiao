#!/usr/bin/env bash
set -euo pipefail

MONGO_CONTAINER="tiao-e2e-mongo"
REDIS_CONTAINER="tiao-e2e-redis"
S3_CONTAINER="tiao-e2e-s3"
MONGO_PORT="${E2E_MONGO_PORT:-27018}"
REDIS_PORT="${E2E_REDIS_PORT:-6380}"
S3_PORT="${E2E_MINIO_PORT:-9002}"

# Skip container management in CI (GitHub Actions provides the services)
if [ "${CI:-}" != "true" ]; then
  # --- MongoDB ---
  if ! docker inspect -f '{{.State.Running}}' "$MONGO_CONTAINER" 2>/dev/null | grep -q true; then
    docker rm -f "$MONGO_CONTAINER" 2>/dev/null || true
    echo "[e2e] Starting MongoDB container on port $MONGO_PORT..."
    docker run -d --name "$MONGO_CONTAINER" -p "$MONGO_PORT:27017" --tmpfs /data/db mongo:7
  else
    echo "[e2e] MongoDB container already running."
  fi

  # --- Redis ---
  if ! docker inspect -f '{{.State.Running}}' "$REDIS_CONTAINER" 2>/dev/null | grep -q true; then
    docker rm -f "$REDIS_CONTAINER" 2>/dev/null || true
    echo "[e2e] Starting Redis container on port $REDIS_PORT..."
    docker run -d --name "$REDIS_CONTAINER" -p "$REDIS_PORT:6379" redis:7-alpine
  else
    echo "[e2e] Redis container already running."
  fi

  # --- S3 (RustFS, MinIO-compatible) ---
  if ! docker inspect -f '{{.State.Running}}' "$S3_CONTAINER" 2>/dev/null | grep -q true; then
    docker rm -f "$S3_CONTAINER" 2>/dev/null || true
    echo "[e2e] Starting S3 container on port $S3_PORT..."
    # RustFS runs as uid 10001, so the tmpfs must be world-writable.
    docker run -d --name "$S3_CONTAINER" \
      -p "$S3_PORT:9000" \
      -e RUSTFS_ACCESS_KEY=minioadmin \
      -e RUSTFS_SECRET_KEY=minioadmin \
      --tmpfs /data:mode=1777 \
      rustfs/rustfs:1.0.1

    echo "[e2e] Initializing S3 bucket..."
    sh "$(dirname "$0")/../scripts/init-s3-bucket.sh" "http://127.0.0.1:$S3_PORT" tiao-e2e
  else
    echo "[e2e] S3 container already running."
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

  # Wait for Redis to be ready
  echo "[e2e] Waiting for Redis..."
  for i in $(seq 1 15); do
    if docker exec "$REDIS_CONTAINER" redis-cli ping 2>/dev/null | grep -q PONG; then
      echo "[e2e] Redis is ready."
      break
    fi
    sleep 1
  done
fi

# Start the server in e2e/test mode (enables test-only routes like test-finish)
exec npm --prefix server run dev:e2e
