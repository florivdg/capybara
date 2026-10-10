## Project: Capybara — control app for the Ulanzi PixBar

Capybara is a Bun + TypeScript + Astro app for driving an **Ulanzi TC002 PixBar** (52×16 RGB pixel clock, stock firmware) over MQTT. It replaces an earlier Python proof of concept (`../pixel-bar`: `pixbar.py`, `unicorn.py`, with mosquitto as the broker).

### Where it's heading

- **Web UI (Astro)**: draw on the display (pixel editor), send text and shapes, and manage custom apps.
- **Device insight**: status, what's currently showing, live previews of frames we send.
- **Integrations**: scheduled/configurable apps fed by external APIs (social stats, weather, …) that render frames and push them to the clock.

So far: the MQTT broker and client, display helpers, three animations (unicorn, dinosaur, capybara), and a proof-of-concept page (`/`) that plays and stops them and clears the screen.

### Principles

- **Bun-native and dependency-light.** MQTT is implemented in-house on `Bun.listen`/`Bun.connect`. Don't add an MQTT library (mqtt.js, aedes, …) or a separate mosquitto broker.
- **Bun is the only runtime, never Node.** The broker uses Bun APIs, and it runs inside the Astro server. Every `astro` invocation goes through `bunx --bun astro …` (the package scripts already do). Plain `astro …` or `bun --bun astro …` either runs Node or recurses into the package's own `astro` script.
- Keep rendering pure (state → `CustomAppFrame`) and separate from transport, so the same code can drive the device, UI previews, and tests.

### Device facts

- 52×16 pixels, origin top-left. Colors are `#RRGGBB` or `0xRRGGBB`.
- A custom app is a JSON frame, sent over HTTP (`POST http://<ip>/api/custom?name=<app>`) or MQTT (publish to `<prefix>/custom/<app>`). The first frame creates the app.
- **Frames alone don't bring an app on screen.** The clock keeps showing whatever app it's on. Publish the app's name to `<prefix>/switchDiyApp` to bring it to the foreground (HTTP: `POST /api/switchDiyApp?name=<app>`).
- **Removing an app only works over HTTP:** `POST /api/custom?name=<app>` with `{}`. The same `{}` over MQTT leaves the app in place (verified on app version 1.1.3).
- The clock's MQTT client id is its prefix (`ulanzi_a834`). It subscribes to `<prefix>/custom/+` and `<prefix>/switchDiyApp`, publishes a retained `<prefix>/status` (`online`), and answers every custom-app frame with its app list on `<prefix>/customList`.
- Reverse-engineered docs for the stock firmware's HTTP API and MQTT: https://github.com/atomicstack/tc002-customisation
- The MQTT prefix is `<mqtt_prefix>_<last 4 of MAC>`, e.g. `ulanzi_a834`. HTTP `GET /getBase` and `/getMqttConfig` return the MAC and `mqtt_prefix`. `GET /api/customList` lists the custom apps.
- Frame fields we know about: `duration` (seconds), `draw` (`dr` rect outline, `df` filled rect, `db` bitmap `[x, y, w, h, pixels[]]`), and `text` (`content`, `fontHeight`, `x`, `y`, `align`, `rect`, `color`). The font is ASCII-only and lacks some lowercase glyphs, so upper-case text.
- Animations stream one full-screen `db` bitmap per tick (~7 KiB at 52×16), at about 8 fps.

### How the server and broker run

- `@astrojs/node` in standalone mode (`output: 'server'`), executed by Bun.
- `src/lib/server/display.ts` owns the broker and the running animation. `display()` starts the broker on first use. The instance lives on `globalThis` because in dev the module is loaded twice (by the integration and by Vite's SSR runner), and both copies must share one broker on port 1883.
- **Dev:** the local integration `src/integrations/pixbar.ts` starts it on `astro:server:setup`, so the clock can connect before any page request, and stops it on `astro:server:done`.
- **Production:** `bun run start` runs `scripts/server.ts`, which starts the broker and then imports `dist/server/entry.mjs` (the adapter's standalone server, which starts itself). SIGINT/SIGTERM stop the broker. `bun run preview` builds first, then starts.
- `Display` runs `play`/`stop`/`clear` one at a time (a promise queue), so a Start can't publish while a Clear still waits on the clock's HTTP API.
- Publishes aren't retained, so a clock that connects after Start would miss the switch. The broker's `onSubscribed` hook lets `Display` re-activate the running stream (fresh frame + `switchDiyApp`) whenever the clock (client id = prefix) subscribes to `switchDiyApp`. The firmware subscribes twice per connect, so this fires twice; that's harmless.
- The UI talks to the server through Astro Actions (`src/actions/index.ts`). Each action returns the new `DisplayStatus`.
- Config comes from env vars: `PIXBAR_PREFIX` (default `ulanzi_a834`), `PIXBAR_APP` (the custom app name, default `capybara`), `MQTT_PORT` (default `1883`), `PIXBAR_IP` (the clock's IP for HTTP calls; by default taken from its MQTT connection), and `PORT`/`HOST` for the HTTP server (the adapter's).
- Port 1883 must be free: stop mosquitto and `bun run broker` before starting Astro.

### Layout

- `src/lib/mqtt/`: MQTT 3.1.1 packet codec (`packets.ts`), topic matching (`topics.ts`), the broker (`broker.ts`, which also offers in-process `publish`/`subscribe` for the app), and the client (`client.ts`).
- `src/lib/pixbar/display.ts`: display constants, frame types, `Canvas`, `customAppTopic`, and `switchAppTopic`.
- `src/lib/pixbar/http.ts`: calls to the clock's HTTP API (`removeCustomApp`); failures throw `ClockError`, which actions turn into a `BAD_GATEWAY` message.
- `src/lib/pixbar/stream.ts`: `streamApp` streams any `Animation` (`{ next(): CustomAppFrame }`) into a custom app: first frame, then `switchDiyApp`, then a timer. The server (`Display.play`) and `scripts/unicorn.ts` both use it, so new animations need no streaming code of their own.
- `src/lib/pixbar/preview.ts` and `src/components/LedMatrix.astro`: each animation button shows a real frame of its animation (its `poster` in `ANIMATIONS`) as an LED dot matrix; unlit LEDs are one SVG pattern, lit ones circles; `PixelIcon.astro` draws small icons from `#`/`.` rows. The page's pixel-art buttons are plain CSS (stepped box-shadows), and its one font, Pixelify Sans, comes from Astro's fonts API (`astro.config.mjs`).
- `src/lib/status-text.ts`: status formatting shared by the page's server render and its client script.
- `src/lib/pixbar/animations/`: frame generators (`unicorn.ts`, `dinosaur.ts`, `capybara.ts`), the shared `drawSprite` helper (`sprite.ts`: sprites as rows of palette characters, `.` transparent), the registry `ANIMATIONS` (`index.ts`), and `names.ts` (names only, so the browser can import them without rendering code). To add an animation: write `createX()` returning `{ next(): CustomAppFrame }`, add its name to `names.ts` and `{ create, poster }` to `index.ts`. The page renders a button per name, and the `play` action validates the name.
- `src/lib/server/display.ts`: the server-side display controller (see above).
- `src/integrations/pixbar.ts`, `src/actions/index.ts`, `src/pages/index.astro`: dev startup hook, actions, and the UI.
- `scripts/`: CLI entry points. `server.ts` is the production entry. `bun run broker` runs a standalone broker. `bun run unicorn [--serve]` streams the unicorn without Astro (`--serve` embeds the broker).
- Tests are colocated `*.test.ts` files; run them with `bun test`.

The broker is for the LAN only and has no auth or TLS. Sessions aren't persisted (every connection is a clean session), and outbound QoS is capped at 1 with no retries.

## Development

When starting the dev server, use background mode:

```
bunx --bun astro dev --background
```

Manage the background server with `bunx --bun astro dev stop`, `… status`, and `… logs`. The broker's log lines show up in the dev logs under `capybara:pixbar`.

Astro binds `localhost`. If another project's dev server already holds `[::1]:4321`, `http://localhost:4321` reaches that one instead. Use `http://127.0.0.1:4321`, or start with `--port`.

## After edits

Always run these and fix every issue. Don't report work as done until they're clean:

1. `bun run lint`: oxlint, type-aware via `oxlint-tsgolint` (`.oxlintrc.json`). `bun run lint:fix` applies autofixes.
2. `bun run typecheck`: `astro check`, which covers `.astro` and `.ts` files.
3. `bun run test`: `bun test`.
4. `bun run fallow`: fallow audit of the changed files (dead code, duplication, complexity). The verdict must not be `fail`.
5. `bunx prettier --write <changed files>`. Don't run `bun run format` (a whole-repo write) unless asked.

`bun run check` runs lint, typecheck, a prettier check, and the tests in one go; CI (`.github/workflows/ci.yml`) runs the same steps. For whole-project passes, use `bun run fallow:dead`, `fallow:dupes`, and `fallow:health`.

Fix lint findings in the code rather than disabling rules. In particular, narrow types with guards instead of `as` casts. When a fallow complexity finding is a deliberate shape (e.g. a flat per-packet-type `switch`), suppress it inline with the reason: `// fallow-ignore-next-line complexity -- <why>`.

### Tooling notes

- `typescript` is pinned to **6.x**. `astro check` uses the compiler API that TypeScript 7 (the native compiler) doesn't expose yet. Track https://github.com/withastro/roadmap/discussions/1321 before bumping.
- `.fallowrc.jsonc` turns on `typeAware`. Without it, fallow can't see members used through inferred types (e.g. `await MqttClient.connect()`) and reports them as unused. The `scripts/*.ts` CLIs are listed as entry points because nothing imports them.
- fallow's CRAP scores are estimates: it reads Istanbul/V8 coverage, but `bun test` only emits lcov.

## Documentation

Full documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)

<!-- fallow:setup-hooks:start -->

## Fallow local gate

Before any `git commit` or `git push`, run `fallow audit --format json --quiet --explain --gate-marker agent`. If the verdict is `fail`, fix the reported findings before retrying. Treat JSON runtime errors like `{ "error": true, ... }` as non-blocking.

Audit defaults to `gate=new-only`: only findings introduced by the current changeset affect the verdict. Inherited findings on touched files are reported under `attribution` and annotated with `introduced: false`, but do not block the commit. Set `[audit] gate = "all"` in `fallow.toml` to gate every finding in changed files.

For non-skill agents, treat the task map below as the local onboarding source: run the listed fallow command before destructive edits, before commits, and before pull request handoff.

## Fallow task map

| When the agent is about to...                                     | Run                                                                                                                                                     |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| delete an "unused" export or file                                 | `fallow dead-code --trace <file>:<export>`                                                                                                              |
| prove a TypeScript symbol's exact consumers before refactoring    | `fallow dead-code --type-aware --symbol-impact <file>:<export-or-class.method>`                                                                         |
| find how one module reaches another                               | `fallow trace --path <from> <to>` (Reports `reachable: false` instead of failing when no import path exists; type-only hops are reported, not skipped.) |
| delete an "unused" dependency                                     | `fallow dead-code --trace-dependency <name>`                                                                                                            |
| commit or open a PR                                               | `fallow audit --base <ref>`                                                                                                                             |
| read a diff before approving it                                   | `fallow review --base <ref> --brief` (orientation, never gates: deterministic and always exit 0, unlike the audit row)                                  |
| prioritize refactoring                                            | `fallow health --hotspots --targets`                                                                                                                    |
| ask who owns code                                                 | `fallow health --ownership`                                                                                                                             |
| check untested-but-reachable code                                 | `fallow health --coverage-gaps`                                                                                                                         |
| consolidate duplication                                           | `fallow dupes --trace dup:<fingerprint>`                                                                                                                |
| find feature flags                                                | `fallow flags`                                                                                                                                          |
| check which architecture rules apply to a file before changing it | `fallow guard <files>`                                                                                                                                  |
| surface security candidates                                       | `fallow security`                                                                                                                                       |
| understand a finding                                              | `fallow explain <issue-type>`                                                                                                                           |
| scope a monorepo                                                  | `--workspace <glob> / --changed-workspaces <ref>` (global flags, prefix any command)                                                                    |

<!-- fallow:setup-hooks:end -->
