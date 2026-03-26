#!/usr/bin/env bash
set -euo pipefail

MONGO_CONTAINER="tiao-e2e-mongo"
REDIS_CONTAINER="tiao-e2e-redis"
MINIO_CONTAINER="tiao-e2e-minio"
MINIO_INIT_CONTAINER="tiao-e2e-minio-init"
MONGO_PORT="${E2E_MONGO_PORT:-27018}"
REDIS_PORT="${E2E_REDIS_PORT:-6380}"
MINIO_PORT="${E2E_MINIO_PORT:-9002}"

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

  # --- MinIO ---
  if ! docker inspect -f '{{.State.Running}}' "$MINIO_CONTAINER" 2>/dev/null | grep -q true; then
    docker rm -f "$MINIO_CONTAINER" 2>/dev/null || true
    echo "[e2e] Starting MinIO container on port $MINIO_PORT..."
    docker run -d --name "$MINIO_CONTAINER" \
      -p "$MINIO_PORT:9000" \
      -e MINIO_ROOT_USER=minioadmin \
      -e MINIO_ROOT_PASSWORD=minioadmin \
      --tmpfs /data \
      minio/minio:latest server /data

    # Wait for MinIO to be ready, then create the bucket
    echo "[e2e] Initializing MinIO bucket..."
    docker rm -f "$MINIO_INIT_CONTAINER" 2>/dev/null || true
    docker run --rm --name "$MINIO_INIT_CONTAINER" \
      --link "$MINIO_CONTAINER:minio" \
      --entrypoint sh \
      minio/mc:latest -c "
        until mc alias set local http://minio:9000 minioadmin minioadmin; do sleep 1; done &&
        mc mb --ignore-existing local/tiao-e2e &&
        mc anonymous set download local/tiao-e2e
      "
  else
    echo "[e2e] MinIO container already running."
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
