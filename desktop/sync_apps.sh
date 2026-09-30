#!/usr/bin/env bash
# Copy the website build (../site) into the desktop app. Run before `npm run dist` / `npm run release`.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p app
cp ../site/index.html ../site/learn.html ../site/explorer.html ../site/fitter.html ../site/analysis.html ../site/icon.png ../site/favicon.png app/
rm -rf app/vendor && cp -R ../site/vendor app/vendor   # KaTeX for the Learn page (works offline)
cp ../site/icon.png build/icon.png
echo "synced $(ls app | wc -l) files into desktop/app"
