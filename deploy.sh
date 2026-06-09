#!/usr/bin/env bash
# Deployment moved to GitHub Pages (2026-06-09). There is no VPS rsync anymore.
#
# Pushing to master triggers .github/workflows/pages.yml, which assembles the
# static app and publishes it to https://myaiexp.github.io/shapez2-solver/.
# The workflow stamps the __COMMIT__ cache-buster with the short SHA.
# mase.fi/shapez 301-forwards there via a Cloudflare redirect rule.
#
# To deploy: just push to master (or run `deploy`).
set -euo pipefail

cat <<'MSG'
shapez2-solver deploys to GitHub Pages on push to master — nothing to run here.
  Workflow:  .github/workflows/pages.yml
  Live:      https://myaiexp.github.io/shapez2-solver/
  Friendly:  https://mase.fi/shapez  (Cloudflare 301 -> Pages)
Just push to master, or run `deploy`.
MSG
