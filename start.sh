#!/usr/bin/env bash
set -e

echo "== SK_AI setup =="

if [ ! -f ".env.local" ]; then
  cp .env.example .env.local
  echo ""
  echo "Created .env.local — open it and paste your OpenRouter API key"
  echo "(get one free at https://openrouter.ai/keys), then re-run this script."
  echo ""
  exit 0
fi

if ! grep -q "OPENROUTER_API_KEY=.\+" .env.local; then
  echo ""
  echo "OPENROUTER_API_KEY is empty in .env.local — add your key from"
  echo "https://openrouter.ai/keys, save the file, then re-run this script."
  echo ""
  exit 1
fi

echo "Installing dependencies (first run only, takes a minute)..."
npm install --silent

echo ""
echo "Starting SK_AI at http://localhost:3000 ..."
npm run dev
