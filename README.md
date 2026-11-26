# Inventory Management

App for tracking coffee product stock at each store. Data lives in Turso; every device signs in with a shared team code.

## Deploying (Expo Hosting)

EAS Workflows deploy automatically: adding the `preview` label to a pull request deploys a preview on the test database (`.eas/workflows/deploy-preview.yml`; remove and re-add the label to deploy a later push), and every merge to `main` deploys to production (`.eas/workflows/deploy-production.yml`). Both use Expo's monthly CI minutes; when those run out, nothing deploys until they reset on the 1st, so deploy by hand. The commands below are for deploying by hand.

Server settings (`TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `TEAM_CODE`) are EAS environment variables with **sensitive** visibility (Expo Hosting can't use secret ones). The `--environment` flag picks the database:

```bash
# Preview link, uses the test database
API_BASE_URL=https://bmanquen-inventory-management--preview.expo.app/api scripts/build-web.sh
npx expo export --platform web && npx eas-cli@latest deploy --alias preview --environment preview

# Production (https://bmanquen-inventory-management.expo.app), uses the real database
API_BASE_URL=https://bmanquen-inventory-management.expo.app/api scripts/build-web.sh
npx expo export --platform web && npx eas-cli@latest deploy --prod --environment production
```

## The app (Expo Exact)

The repo root is an [Expo Exact](https://github.com/expo/exact) app: `app.contract` (the screens), `app.ts` (the data module), `app.forma` (colours and icons), `app.test.contract` (tests) and `app.json` (Exact's manifest). Beside it is a small Expo project that only hosts it: `app.config.json` is Expo's config, and Expo Router serves the API at `/api/*` (`src/app/api/[...path]+api.ts`, handler in `src/server/api.ts`) plus the app's page at `/`, `/products` and `/stores`.

`scripts/build-web.sh` builds the app into `public/`, and `expo export` ships that page beside the API. Both EAS workflows run the script before deploying; `API_BASE_URL` picks which site's API the page calls. Exact is not on npm, so the script clones expo/exact at a pinned commit and needs Rust (it installs rustup) and Bun.

There is no Expo Go: Expo Go can't run Exact apps. iPhone builds need a Mac (`bun exact.mjs share`).

## TestFlight (iPhone)

The iPhone app is `dev.offbyonelabs.coopinventory` in App Store Connect (team Off By One LLC). Its app record was created by hand (appstoreconnect.apple.com → New App), since API keys can't create one; a new bundle ID needs that before its first upload.

On a Mac with a released Xcode 27.1+ and Exact at the commit `scripts/build-web.sh` pins, `scripts/build-ios.sh` builds an App Store-signed `target/CoopInventory.ipa` against the production API. It needs an Apple Distribution certificate in the keychain (`EXACT_IDENTITY`, its SHA-1), an App Store provisioning profile for the app ID (`EXACT_PROFILE`), and a build number above the last upload (`EXACT_BUILD_NUMBER`). The certificate and its private key are kept as a `.p12` in the Amp project secrets `APPLE_SIGNING_P12_B64` and `APPLE_SIGNING_P12_PASSWORD`, which Amp's Mac signing step installs; the profile can be downloaded from Apple.

Upload with `xcrun altool --upload-app -f target/CoopInventory.ipa -t ios --apiKey <key id> --apiIssuer <issuer id>`. Apple processes it in 5 to 30 minutes; then add it to a TestFlight group. A tester must accept TestFlight's email invite on their iPhone, or TestFlight says the app is "not available".

## Versions

The version people see is `version` in `app.json`; both store build scripts read it. Raise it in a PR when a new store release starts (1.0.1 for fixes, 1.1.0 for features): App Store Connect takes no more builds for a version once it is released. Until then, TestFlight builds stay on the same version with a rising build number. The build number is never committed: pass the next one to each build, above the last upload to that store (App Store Connect per version; Google Play for every upload ever).

## Google Play (Android)

The app is in Play internal testing (1.0.0 (1)). With the Android SDK (platform 37.2 and an NDK), a JDK 17+ and `npm install` (`bun .exact/checkout/scripts/exact.mjs setup --check --platform android` names what's missing), `scripts/build-android.sh` builds a signed `target/CoopInventory.aab` against the production API. It needs the upload keystore (`EXACT_KEYSTORE`, `EXACT_KEYSTORE_PASSWORD`, `EXACT_KEY_ALIAS`, `EXACT_KEY_PASSWORD`), which is kept in the Amp project secrets of those names, with the keystore file base64-encoded as `EXACT_KEYSTORE_B64` (the script decodes it when `EXACT_KEYSTORE` is unset), and a version code above every one Play has taken (`EXACT_BUILD_NUMBER`). Play Console already has the app record for `dev.offbyonelabs.coopinventory`; for a new release, upload the `.aab` there.

## Local development

Clone https://github.com/expo/exact beside this repo and run `bun scripts/exact.mjs setup` there once, then `npm install` here. See `AGENTS.md` for the commands: `bun server.ts` (the same API handler, on Turso or a scratch database), `bun exact.mjs web` (the app), `bun exact.mjs test web` (the app's tests) and `bun test tools/` (the API's own tests).
