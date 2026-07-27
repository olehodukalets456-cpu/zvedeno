#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Install Node.js 22 LTS, then run this script again."
  exit 1
fi

NODE_MAJOR="$(node -p "Number(process.versions.node.split('.')[0])")"
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "Node.js 22 or newer is required. Current version: $(node -v)"
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is not installed or not available in PATH."
  exit 1
fi

if command -v corepack >/dev/null 2>&1; then
  corepack enable
  corepack prepare pnpm@9.15.9 --activate
elif ! command -v pnpm >/dev/null 2>&1; then
  echo "Corepack and pnpm are unavailable. Install pnpm 9.15.9, then run this script again."
  exit 1
fi

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example"
fi

echo "Starting PostgreSQL..."
docker compose up -d

echo "Installing dependencies..."
pnpm install

echo "Generating database migration..."
pnpm db:generate

echo "Applying database migration..."
pnpm db:migrate

echo

echo "Local setup is ready. Start Zvedeno with:"
echo "  pnpm dev"
echo

echo "Then open http://localhost:3000"
