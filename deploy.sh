#!/usr/bin/env bash
# Sync project files to /var/www/html/shapez/ for mase.fi/shapez
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEBROOT="/var/www/html/shapez"

sudo rsync -a --delete \
    --exclude='.git/' \
    --exclude='.claude/' \
    --exclude='.gitignore' \
    --exclude='README.md' \
    --exclude='CLAUDE.md' \
    --exclude='deploy.sh' \
    "$PROJECT_DIR/" "$WEBROOT/"

# Stamp the cache-buster: replace __COMMIT__ in index.html asset refs with the
# deployed commit hash. nginx then serves these ?v=<sha> assets immutable, and
# the token bumps on every deploy so a content change is never served stale.
# .git/ is rsync-excluded, so read the SHA from the source repo.
SHORT_SHA=$(git -C "$PROJECT_DIR" rev-parse --short HEAD)
sudo sed -i "s/__COMMIT__/$SHORT_SHA/g" "$WEBROOT/index.html"

sudo chown -R www-data:www-data "$WEBROOT"
echo "Synced to $WEBROOT @ $SHORT_SHA"
