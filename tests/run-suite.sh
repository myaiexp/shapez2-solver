#!/usr/bin/env bash
# The full test gate — the one definition shared by CI (.github/workflows/pages.yml),
# .githooks/pre-commit and `npm test`, so the three cannot drift apart.
#
# node --test runs each file in its own process (a non-zero exit fails the run) and
# measures coverage of the root *.js modules. The thresholds are a floor against
# erosion: integers (node truncates decimals), set at or just under the current
# numbers. Raise them when coverage rises; don't lower them to land a change.
# Only modules some test loads are measured, so an untested module would be
# absent rather than 0%; tests/meta/coverageReach.test.js fails on one.
# Needs Node >= 22.8 for the --test-coverage-* threshold flags.
set -euo pipefail
cd "$(dirname "$0")/.."

# Quoted array iteration keeps paths with spaces as one file. The count floor is a
# canary for an empty/missing tests/ tree, which would otherwise pass vacuously.
mapfile -t TESTS < <(find tests -name '*.test.js' | sort)
if [ "${#TESTS[@]}" -lt 30 ]; then
  echo "expected >=30 test files, found ${#TESTS[@]}" >&2
  exit 1
fi

node --test \
  --experimental-test-coverage \
  --test-coverage-include='*.js' \
  --test-coverage-exclude='tests/**' \
  --test-coverage-lines=97 \
  --test-coverage-branches=94 \
  --test-coverage-functions=97 \
  "${TESTS[@]}" tests/harness/smoke.js

node tests/harness/solve.mjs 'CuCu----' --start CuCuCuCu --ops Cutter --json --expect-solved
node tests/harness/solve.mjs --explore 2
