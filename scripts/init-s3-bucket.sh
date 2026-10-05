#!/usr/bin/env sh
# Create a bucket on a local S3-compatible server and allow anonymous reads,
# so profile-picture URLs load in the browser without signing.
#
#   scripts/init-s3-bucket.sh <endpoint> <bucket>
#
# Waits for the endpoint, is safe to re-run, and uses the dev credentials
# (minioadmin/minioadmin) unless AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY are
# set. Uses the host `aws` CLI when present, else the amazon/aws-cli image.
set -eu

ENDPOINT="$1"
BUCKET="$2"

export AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-minioadmin}"
export AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-minioadmin}"
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-us-east-1}"
# Ignore any personal ~/.aws profile.
export AWS_CONFIG_FILE=/dev/null
export AWS_SHARED_CREDENTIALS_FILE=/dev/null

s3api() {
  if command -v aws >/dev/null 2>&1; then
    aws --endpoint-url "$ENDPOINT" s3api "$@"
  else
    docker run --rm --network host \
      -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_DEFAULT_REGION \
      amazon/aws-cli:2.37.9 --endpoint-url "$ENDPOINT" s3api "$@"
  fi
}

for _ in $(seq 1 30); do
  if s3api list-buckets >/dev/null 2>&1; then break; fi
  sleep 1
done

if ! s3api head-bucket --bucket "$BUCKET" >/dev/null 2>&1; then
  s3api create-bucket --bucket "$BUCKET" >/dev/null
fi

s3api put-bucket-policy --bucket "$BUCKET" --policy "{
  \"Version\": \"2012-10-17\",
  \"Statement\": [{
    \"Effect\": \"Allow\",
    \"Principal\": {\"AWS\": [\"*\"]},
    \"Action\": [\"s3:GetObject\"],
    \"Resource\": [\"arn:aws:s3:::$BUCKET/*\"]
  }]
}"

echo "[s3] Bucket $BUCKET ready at $ENDPOINT (public read)."
