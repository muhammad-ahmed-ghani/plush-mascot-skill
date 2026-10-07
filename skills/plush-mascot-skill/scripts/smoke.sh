#!/usr/bin/env bash
# Scaffold into a temp dir, bootstrap with draft quality, build, load the page headless, clean up.
#   bash smoke.sh [--link-node-modules DIR] [--keep]
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; TMP="$(mktemp -d)"; LINK=""; KEEP=0
while [ $# -gt 0 ]; do case "$1" in --link-node-modules) LINK="$2"; shift;; --keep) KEEP=1;; esac; shift; done
cleanup() { [ -n "${PID:-}" ] && kill "$PID" 2>/dev/null || true; [ "$KEEP" = 1 ] && echo "kept $TMP" || rm -rf "$TMP"; }; trap cleanup EXIT
if [ -n "$LINK" ]; then ARGS=(--link-node-modules "$LINK"); else ARGS=(--install); fi
node "$HERE/scaffold.mjs" "$TMP/p" --name Smoke --slug smoke --product Test "${ARGS[@]}" --bootstrap --quality draft
cd "$TMP/p" && npm run build >/dev/null
node_modules/.bin/vite preview --host 127.0.0.1 --port 4218 --strictPort >/dev/null 2>&1 & PID=$!
for i in $(seq 1 30); do curl -sf http://127.0.0.1:4218/ >/dev/null && break; sleep 0.5; done
MASCOT_ORIGIN=http://127.0.0.1:4218 node scripts/dev/smoke.mjs && echo "SMOKE PASS"
