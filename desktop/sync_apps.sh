#!/usr/bin/env bash
# Copy the website build (../site) into the desktop app. Run before `npm run dist` / `npm run release`.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p app
cp ../site/index.html ../site/explorer.html ../site/fitter.html ../site/icon.png ../site/favicon.png app/
cp ../site/icon.png build/icon.png
echo "synced $(ls app | wc -l) files into desktop/app"
