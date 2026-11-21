#!/usr/bin/env bash
# Builds the Exact app (exact-trial/) into public/, which `expo export` ships beside the /api routes.
# Usage: API_BASE_URL=https://<site>/api scripts/build-web.sh
set -euo pipefail
: "${API_BASE_URL:?Set API_BASE_URL to the deployed API, such as https://bmanquen-inventory-management.expo.app/api}"

# Exact is not on npm: build from this commit of expo/exact (the one the tests last passed on).
EXACT_COMMIT=a35cd3012f9599aebff7842980a79a68225f4057
root=$(cd "$(dirname "$0")/.." && pwd)
export EXACT=${EXACT:-$root/../exact}

if [ ! -e "$EXACT/scripts/app-cli.mjs" ]; then
  git clone -q https://github.com/expo/exact.git "$EXACT"
  git -C "$EXACT" checkout -q "$EXACT_COMMIT"
fi
command -v bun >/dev/null || { curl -fsSL https://bun.sh/install | bash; export PATH="$HOME/.bun/bin:$PATH"; }
command -v rustup >/dev/null || curl -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain none
export PATH="$HOME/.cargo/bin:$PATH"
(cd "$EXACT" && bun scripts/exact.mjs setup --platform web)

cd "$root/exact-trial"
bun install --frozen-lockfile
bun exact.mjs web-build --out dist
rm -rf "$root/public" && cp -R dist "$root/public"
# Expo Hosting serves /products from products.html; Exact's client draws the tab from the URL.
cp dist/shell.html "$root/public/products.html"
cp dist/shell.html "$root/public/stores.html"
