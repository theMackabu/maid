#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

mode="${1:-publish}"

esbuild_bin="$root/node_modules/.bin/esbuild"
if [[ ! -x "$esbuild_bin" ]]; then
  esbuild_bin="$(command -v esbuild || true)"
fi

if [[ -z "$esbuild_bin" ]]; then
  echo "maid publish: esbuild is required to prebundle release JavaScript; run ant install first" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "maid publish: node is required to read package.json for the bundle version" >&2
  exit 1
fi

version="$(node -e "const pkg = require('./package.json'); process.stdout.write(String(pkg.name || 'maid') + ' ' + String(pkg.version || '0.0.0'))")"
banner="import { createRequire as __maidCreateRequire } from 'node:module'; const require = __maidCreateRequire(import.meta.url); globalThis.__MAID_VERSION__ = $(node -e "process.stdout.write(JSON.stringify(process.argv[1]))" "$version");"

mkdir -p generated

"$esbuild_bin" src/main.ts \
  --bundle \
  --platform=node \
  --format=esm \
  --external:node:* \
  --external:ant:* \
  "--banner:js=$banner" \
  --outfile=generated/maid-main.mjs

"$esbuild_bin" src/sandbox-run.ts \
  --bundle \
  --platform=node \
  --format=esm \
  --external:node:* \
  --external:ant:* \
  "--banner:js=$banner" \
  --outfile=generated/maid-sandbox-run.mjs

if [[ "$mode" == "--prebuild-only" ]]; then
  exit 0
fi

cargo publish "$@"
