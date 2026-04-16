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

sudo chown -R www-data:www-data "$WEBROOT"
echo "Synced to $WEBROOT"
