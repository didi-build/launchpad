#!/usr/bin/env bash
set -euo pipefail

: "${BASE_REF:?BASE_REF is required}"
: "${GITHUB_OUTPUT:?GITHUB_OUTPUT is required}"

if ! git rev-parse --verify "origin/${BASE_REF}" >/dev/null 2>&1; then
  echo "::error::origin/${BASE_REF} missing after checkout"
  exit 1
fi

changed="$(git diff --name-only "origin/${BASE_REF}...HEAD")"
if grep -q '^\.github/workflows/' <<<"$changed"; then
  echo "run=true" >> "$GITHUB_OUTPUT"
else
  echo "run=false" >> "$GITHUB_OUTPUT"
fi
