<!-- exact:begin (exact new writes this block; bun exact.mjs update rewrites it) -->
# inventory-management: an Exact app

Run `bun exact.mjs --help` first to create `.exact/checkout`; set `EXACT=<checkout>` if needed.

`app.contract` is the view, `app.ts` the data module, `app.test.contract` the tests, `app.json`
the manifest: set `app.name` and `app.id` before building. The app uses Exact at
`.exact/checkout` by path (`EXACT` overrides it).

Start from the nearest pattern: `bun exact.mjs
pattern` lists them and `pattern <name>` writes one, tested. .exact/checkout/docs/start-here-site.md (a site) or
.exact/checkout/docs/start-here.md is the only required reading. `bun exact.mjs contract vocab <name>` answers a
name (none: the card); `bun exact.mjs docs <heading words>` a guide's
section. Run `bun exact.mjs verify` when the features work, and `verify ios|android` at the end for a
phone app. When an iPhone app is ready to try, run `bun exact.mjs share` and send its link;
repeat for each change the person should see. `bun exact.mjs help` lists the verbs, including
app.json's `"commands"`.
`bun exact.mjs update` refreshes files. Native verbs (`ios`, `mac`, `linux`, `android`, `windows`)
name their platform in app.json on first use and build in a generated workspace;
`update --without <platform>` stops shipping it.
`bun .exact/checkout/scripts/exact.mjs setup --check` names what a native build lacks (`--platform ios --device` for a phone's: `share`, `ios --device`).

Generated, so don't edit: `exact.mjs` and this block.

## Feedback (required)

When a doc was wrong or missing, a workaround was needed, something took several tries or a
command confused you, record it: `bun exact.mjs feedback note "<what happened>"`. It attaches
exact2's commit and the last exit code, never output or code. `bun exact.mjs feedback status` says
whether notes are sent and whether to keep a diary; under `never`, skip all of this.
<!-- exact:end -->

## This app

Co-op Inventory: coffee stock at each store, on Turso, with one shared team code for every device.
The repo root is the Exact app (`app.contract`, `app.ts`, `app.forma`, `app.test.contract`, `app.json`)
plus a small Expo project that only hosts it:

- `src/server/api.ts`: the REST API handler, shared by `server.ts` (local dev and Exact's tests) and
  Expo Hosting's `/api/*` (`src/app/api/[...path]+api.ts`). `src/server/db.ts` holds the tables both create.
- `src/app/index+api.ts`, `src/app/[page]+api.ts`: answer `/`, `/products` and `/stores` with Exact's
  `shell.html`. Add a new route in `routes nav` to `PAGES` in `src/server/page.ts` too.
- `src/app/api/inventory+api.ts`: the old React Native app's API, kept for clients still on it.
- `app.config.json`: Expo's config (hosting and EAS). `app.json` is Exact's manifest, not Expo's.
- `scripts/build-web.sh`: builds the app into `public/`, which `expo export` ships beside `/api`.

Exact is not on npm: clone https://github.com/expo/exact, run `bun scripts/exact.mjs setup` there once,
and `exact.mjs` finds it beside this repository or through `EXACT=<checkout>`. Run `npm install` for
`server.ts`'s database client.

- `TURSO_DATABASE_URL=… TURSO_AUTH_TOKEN=… TEAM_CODE=… bun server.ts`: the API on 127.0.0.1:8787, on Turso.
  Every request needs `Authorization: Bearer <team code>`.
- `bun exact.mjs web`: the app on 127.0.0.1:8765.
- `bun exact.mjs test web` / `verify`: the tests, on a scratch database where the code is always `test-code`
  (stop `server.ts` first).
- `bun test tools/`: the API on its own, on an in-memory database (`tools/` never makes Exact's build stale).
- `npx tsc --noEmit` and `npx expo lint`: the API's typecheck and lint. Exact type-checks `app.ts` on
  every build. Run all of these before declaring a task done.

Where this app differs from Exact's templates on purpose: production's API is Expo Router routes on
Expo Hosting, on Turso (`server.ts` serves the same handler only for local dev and tests); the team
code is `state code persist`, not `secret.keep`, so nobody is signed out; and the app paints its own
controls and type sizes, a design decision rather than Exact's defaults.

Don't change `app.id` in `app.json`: Exact keeps the saved team code under it, so a new id signs
everyone out.

## Expo (hosting only)

The Expo side is Expo Router API routes deployed to Expo Hosting with EAS; there are no React Native
screens and no Expo Go. Expo ships breaking changes every SDK release, so before touching an Expo or
EAS API, read the `expo` major version in `package.json` and fetch
`https://docs.expo.dev/versions/v<major>.0.0/` (or https://docs.expo.dev/llms.txt) instead of answering
from memory. Add packages with `npx expo install <package>`, and run EAS as `npx eas-cli@latest <command>`.
