# Rules for AI coding assistants working on Njia (GitHub Copilot, Claude, others)

Njia is an offline-first Android GPS trip recorder built with Expo (React Native) and TypeScript.
The owner is not a career programmer. He tests the installed app and reports what he sees.
Explain things in plain language and keep changes small and safe.

## Check the installed versions before using an API

Expo changes its APIs between SDK versions. Before using any Expo or React Native API:

1. Read the `expo` version in `package.json`.
2. Read the type definitions in `node_modules/<package>/build/*.d.ts`, or the matching docs at
   `https://docs.expo.dev/versions/v<major>.0.0/`. Do not answer from memory.

Install packages with `npx expo install <package>` so versions match the SDK.

## What must not be broken

- **`index.ts` imports `./src/tracking/task` first.** The background GPS job must be registered before anything else. Do not reorder.
- **`src/core/` stays pure TypeScript.** No `react-native`, `expo-*` or browser imports there. The phone app, the viewer and the tests all share it.
- **The database only grows.** Add tables with `CREATE TABLE IF NOT EXISTS` and columns with `ensureColumn()` in `src/data/db.ts`. Never drop, rename or reset. Real trips live on the owner's phone.
- **Offline first.** Recording, saving, viewing the path, stops and stats must work with no network. Only the street-map background may need internet.
- **Never commit recorded trips** (`.gpx`, `njia_*.json`). They show where a real person has been.
- **Do not create or edit `android/` or `ios/` by hand.** They are generated. Native settings go in `app.config.js`.
- **No Expo Router.** Navigation is a single state value in `App.tsx` on purpose (three screens).

## How to work

- Small files, one job each. New feature = new file where sensible.
- Every screen sets explicit text and background colours from `src/theme.ts` (the app is dark-only).
- After editing anything in `viewer/`, run `npm run build:viewer`. The output in `src/generated/` and `dist/` is generated: never edit it by hand.
- Before saying a change is done, run `npm run check` (viewer build, type check, tests). Add a test in `tests/` for any change to `src/core/`.
- The app cannot run in Expo Go (background location needs native code). Pushing to `main` builds an APK through `.github/workflows/build-apk.yml`; the owner installs that to test.
- Error messages shown to the user must say what happened and what to do next, in plain words.

## Commands

```
npm install            # install + build viewer
npm run check          # build viewer, type check, tests
npm run build:viewer   # rebuild viewer only
npm test               # tests only
```
