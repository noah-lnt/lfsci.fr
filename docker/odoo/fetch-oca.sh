#!/usr/bin/env bash
# Fetches the OCA repositories Phase 0 needs and exposes every module to Odoo.
# Run it (bash docker/odoo/fetch-oca.sh), never paste it into an interactive shell.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

BRANCH=18.0
OCA_DIR=docker/odoo/oca
ADDONS_DIR=docker/odoo/addons

REPOS=(
  bank-statement-import
  account-reconcile
  account-financial-reporting
  account-financial-tools
  l10n-france
  web
  server-ux
  server-tools
  reporting-engine
  queue
)

mkdir -p "$OCA_DIR" "$ADDONS_DIR"

for repo in "${REPOS[@]}"; do
  target="$OCA_DIR/$repo"
  if [ -d "$target/.git" ]; then
    echo "== $repo: updating"
    git -C "$target" fetch --depth 1 origin "$BRANCH"
    git -C "$target" reset --hard FETCH_HEAD
  else
    echo "== $repo: cloning"
    git clone --depth 1 --branch "$BRANCH" "https://github.com/OCA/$repo.git" "$target"
  fi
done

echo "== linking modules into $ADDONS_DIR"
# The link target is relative so it resolves both on the host and in the
# container, where addons sits at /mnt/extra-addons and oca at /mnt/oca.
find "$ADDONS_DIR" -maxdepth 1 -type l -delete
linked=0
for manifest in "$OCA_DIR"/*/*/__manifest__.py; do
  module_dir="$(dirname "$manifest")"
  module="$(basename "$module_dir")"
  ln -sfn "../oca/$(basename "$(dirname "$module_dir")")/$module" "$ADDONS_DIR/$module"
  linked=$((linked + 1))
done
echo "linked $linked modules"
