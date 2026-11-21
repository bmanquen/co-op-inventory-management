# Inventory Management

Expo app for tracking coffee product stock at each store. Data lives in Turso; every device signs in with a shared team code.

## Deploying (Expo Hosting)

EAS Workflows deploy automatically: every pull request gets a preview deploy on the test database (`.eas/workflows/deploy-preview.yml`), and every merge to `main` deploys to production (`.eas/workflows/deploy-production.yml`). The commands below are for deploying by hand.

Server settings (`TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `TEAM_CODE`) are EAS environment variables with **sensitive** visibility (Expo Hosting can't use secret ones). The `--environment` flag picks the database:

```bash
# Preview link, uses the test database
npx expo export --platform web && npx eas-cli@latest deploy --environment preview

# Production (https://bmanquen-inventory-management.expo.app), uses the real database
npx expo export --platform web && npx eas-cli@latest deploy --prod --environment production
```

## Open on a phone (Expo Go)

Every merge to `main` also publishes an update that runs in the free **Expo Go** app (iPhone or Android), against the production API. To open it: install Expo Go from the App Store or Play Store, then on expo.dev open the project's **Updates**, tap the newest update, press **Preview**, and scan the QR code (iPhone: Camera app; Android: the scanner in Expo Go). By hand: `npx eas-cli@latest update --branch main --message "..." --environment production`.

Expo Go only runs the newest Expo SDK, so the app has to be upgraded when the next SDK ships.

## Local development

See `.env.example`: run `turso dev --db-file data/dev.db` and `npx expo start --web`.
