#!/usr/bin/env bash
# Builds the Android app as a signed App Bundle (.aab) for Google Play, with the Android SDK (platform 37.2 and an NDK)
# and a JDK 17+; `bun .exact/checkout/scripts/exact.mjs setup --check --platform android` names what's missing.
# Usage: EXACT_KEYSTORE=<upload keystore file> EXACT_KEYSTORE_PASSWORD=… EXACT_KEY_ALIAS=… EXACT_KEY_PASSWORD=… \
#        EXACT_BUILD_NUMBER=<next versionCode> scripts/build-android.sh
# Writes target/CoopInventory.aab; upload it in Play Console or with the Play Developer API.
set -euo pipefail
# The upload keystore is kept base64-encoded in the Amp project secret EXACT_KEYSTORE_B64, beside the other three.
if [ -z "${EXACT_KEYSTORE:-}" ] && [ -n "${EXACT_KEYSTORE_B64:-}" ]; then
  export EXACT_KEYSTORE=$(mktemp)
  trap 'rm -f "$EXACT_KEYSTORE"' EXIT
  base64 -d <<<"$EXACT_KEYSTORE_B64" >"$EXACT_KEYSTORE"
fi
: "${EXACT_KEYSTORE:?Set EXACT_KEYSTORE to the upload keystore file}"
: "${EXACT_KEYSTORE_PASSWORD:?Set EXACT_KEYSTORE_PASSWORD}"
: "${EXACT_KEY_ALIAS:?Set EXACT_KEY_ALIAS}"
: "${EXACT_KEY_PASSWORD:?Set EXACT_KEY_PASSWORD}"
# Play refuses a versionCode at or below any it has taken, on any track.
: "${EXACT_BUILD_NUMBER:?Set EXACT_BUILD_NUMBER above every versionCode uploaded to Play}"
export API_BASE_URL=${API_BASE_URL:-https://bmanquen-inventory-management.expo.app/api}
EXACT_KEYSTORE=$(cd "$(dirname "$EXACT_KEYSTORE")" && pwd)/$(basename "$EXACT_KEYSTORE")

root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
# The version people see is app.json's `version`; change it there when a new store release starts.
export EXACT_VERSION=${EXACT_VERSION:-$(bun -p 'require("./app.json").version')}
# Build from the Exact commit build-web.sh pins (the one the tests last passed on): every upload uses a version code.
export EXACT=${EXACT:-$root/../exact}
pin=$(sed -n 's/^EXACT_COMMIT=//p' scripts/build-web.sh)
[ "$(git -C "$EXACT" rev-parse HEAD)" = "$pin" ] || { echo "Check out Exact $pin in $EXACT first" >&2; exit 1; }
bun exact.mjs android --bundle --json
cp target/android/app/outputs/bundle/release/app-release.aab target/CoopInventory.aab
echo "target/CoopInventory.aab"
