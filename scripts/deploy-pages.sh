#!/usr/bin/env bash
# Publie le module construit (apps/web/public/prototype/dist) sur la branche gh-pages du dépôt GitHub.
# Usage : scripts/deploy-pages.sh [remote-url]   (défaut : https://github.com/chouk13/wallscan)
# GitHub Pages doit être réglé sur « Deploy from a branch » → gh-pages / (root). URL : https://chouk13.github.io/wallscan/
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REMOTE="${1:-https://github.com/chouk13/wallscan}"
DIST="$ROOT/apps/web/public/prototype/dist"

cd "$ROOT"
pnpm build:prototype --bundles
test -s "$DIST/index.html"

TMP="$(mktemp -d)"
cp -r "$DIST/." "$TMP/"
touch "$TMP/.nojekyll"
cd "$TMP"
git init -q
git checkout -q -b gh-pages
git add -A
git -c user.name="WallScan deploy" -c user.email="deploy@wallscan.local" commit -q -m "deploy: module WallScan $(date -u +%Y-%m-%dT%H:%MZ)"
git push --force "$REMOTE" gh-pages:gh-pages
cd "$ROOT"
rm -rf "$TMP"
echo "Publié sur gh-pages → https://chouk13.github.io/wallscan/ (propagation : 1 à 2 minutes)"
