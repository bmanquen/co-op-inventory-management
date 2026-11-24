#!/usr/bin/env bash
# Builds the iPhone app as an App Store-signed .ipa for TestFlight, on a Mac with Xcode 27.1+ (a released one:
# Apple refuses uploads from a beta Xcode, so set DEVELOPER_DIR when the default is a beta).
# Usage: EXACT_IDENTITY=<distribution cert SHA-1> EXACT_PROFILE=<App Store .mobileprovision> \
#        EXACT_BUILD_NUMBER=<next build number> scripts/build-ios.sh
# Writes target/CoopInventory.ipa; upload it with `xcrun altool --upload-app` and an App Store Connect API key.
set -euo pipefail
: "${EXACT_IDENTITY:?Set EXACT_IDENTITY to the SHA-1 of the Apple Distribution certificate}"
: "${EXACT_PROFILE:?Set EXACT_PROFILE to the App Store provisioning profile for app.id}"
: "${EXACT_BUILD_NUMBER:?Set EXACT_BUILD_NUMBER above the last uploaded build}"
export API_BASE_URL=${API_BASE_URL:-https://bmanquen-inventory-management.expo.app/api}
# The app only uses HTTPS, so it answers Apple's export-compliance question with no.
export EXACT_NON_EXEMPT_ENCRYPTION=false

root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
# The version people see is app.json's `version`; change it there when a new store release starts.
export EXACT_VERSION=${EXACT_VERSION:-$(bun -p 'require("./app.json").version')}
# Build from the Exact commit build-web.sh pins (the one the tests last passed on): every upload uses a build number.
export EXACT=${EXACT:-$root/../exact}
pin=$(sed -n 's/^EXACT_COMMIT=//p' scripts/build-web.sh)
[ "$(git -C "$EXACT" rev-parse HEAD)" = "$pin" ] || { echo "Check out Exact $pin in $EXACT first" >&2; exit 1; }
bun exact.mjs ios --device --archive target/CoopInventory.ipa --json
