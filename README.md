# Inventory Management

App for tracking coffee product stock at each store. Data lives in Turso; every device signs in with a shared team code.

## Deploying (Expo Hosting)

EAS Workflows deploy automatically: every pull request gets a preview deploy on the test database (`.eas/workflows/deploy-preview.yml`), and every merge to `main` deploys to production (`.eas/workflows/deploy-production.yml`). The commands below are for deploying by hand.

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

The app's screens are an [Expo Exact](https://github.com/expo/exact) app in `exact-trial/` (Contract view, `app.ts` data module, tests). `scripts/build-web.sh` builds it into `public/`, and `expo export` ships that page beside the API at `/api/*` (`src/app/api/[...path]+api.ts`, handler in `src/server/api.ts`). Both EAS workflows run the script before deploying; `API_BASE_URL` picks which site's API the page calls. Exact is not on npm, so the script clones expo/exact at a pinned commit and needs Rust (it installs rustup) and Bun.

`/api/inventory` is the old React Native app's API, kept so phones and open tabs still on that version keep working; remove it once nobody uses it.

There is no Expo Go: Expo Go can't run Exact apps. iPhone builds need a Mac (`bun exact.mjs share` in `exact-trial/`).

## Local development

See `exact-trial/AGENTS.md`: `bun server.ts` (same API handler, on Turso or a scratch database) and `bun exact.mjs web`. `bun exact.mjs test web` runs the tests.
