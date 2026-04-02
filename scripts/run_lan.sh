#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "${script_dir}/.." && pwd)"

cd "${repo_root}"

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required to start MiniGode." >&2
  exit 1
fi

monaco_loader_path="node_modules/monaco-editor/min/vs/loader.js"

if [ ! -f "${monaco_loader_path}" ]; then
  echo "Installing npm dependencies..."
  if [ -f package-lock.json ]; then
    npm ci
  else
    npm install
  fi
fi

HOST="${HOST:-0.0.0.0}" PORT="${PORT:-3000}" npm start
