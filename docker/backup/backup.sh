#!/usr/bin/env bash
set -euo pipefail

hourly_interval=3600
endpoint_args=(--endpoint-url "$STORAGE_ENDPOINT" --region "$STORAGE_REGION")

dump() {
  local kind="$1"
  local stamp
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  local file="/tmp/lfsci-${kind}-${stamp}.dump"
  pg_dump --format=custom --compress=6 --file "$file" "$PGDATABASE"
  pg_restore --list "$file" > /dev/null
  aws "${endpoint_args[@]}" s3 cp "$file" "s3://${BACKUP_BUCKET}/${kind}/$(basename "$file")" --only-show-errors
  rm -f "$file"
  echo "$(date -u +%FT%TZ) ${kind} backup uploaded"
}

prune() {
  local cutoff
  cutoff="$(date -u -d "-${BACKUP_RETENTION_DAYS} days" +%Y%m%dT%H%M%SZ)"
  for kind in hourly nightly; do
    aws "${endpoint_args[@]}" s3 ls "s3://${BACKUP_BUCKET}/${kind}/" | awk '{print $4}' | while read -r name; do
      [ -z "$name" ] && continue
      local stamp="${name#lfsci-${kind}-}"
      stamp="${stamp%.dump}"
      if [[ "$stamp" < "$cutoff" ]]; then
        aws "${endpoint_args[@]}" s3 rm "s3://${BACKUP_BUCKET}/${kind}/${name}" --only-show-errors
      fi
    done
  done
}

last_nightly_day=""
while true; do
  dump hourly
  today="$(date -u +%F)"
  if [ "$today" != "$last_nightly_day" ] && [ "$(date -u +%H)" = "02" ]; then
    dump nightly
    prune
    last_nightly_day="$today"
  fi
  sleep "$hourly_interval"
done
