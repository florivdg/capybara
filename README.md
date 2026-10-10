# Capybara

A local control app for the **Ulanzi TC002 PixBar**, a 52×16 RGB pixel clock, built with Bun, TypeScript and Astro.

Capybara runs its own MQTT broker. Point the clock at it, and the app can push content to the clock's display: animations, and later text, drawings and data from other services.

> **Status: early proof of concept.** It can stream one of three animations (a unicorn, a dinosaur and a capybara) to the clock, stop it, and clear it again from a small web page. Everything else below under [Roadmap](#roadmap) is planned, not built.

## What works today

- **Built-in MQTT broker** written in TypeScript on Bun's TCP sockets. No mosquitto or MQTT library needed; it starts together with the web server.
- **Web page** at `/` with three buttons:
  - **Unicorn**, **Dinosaur**, **Capybara**: stream that animation at 8 fps and bring it to the front of the clock. The unicorn gallops back and forth, the dinosaur jumps over cacti, and the capybara wanders across with an orange on its head, stopping halfway to chill.
  - **Stop**: stops streaming. The last frame stays up briefly.
  - **Clear screen**: removes Capybara's app from the clock, so it goes back to its own apps.
- **Reconnects**: if the clock drops off Wi-Fi and comes back, a running animation is brought to the front again automatically.
- **Command-line tools** to run the broker on its own or stream the unicorn without the web app.

## Requirements

- [Bun](https://bun.sh) 1.4 or newer. Capybara runs on Bun only, not Node.
- A Ulanzi TC002 with its stock firmware, on the same network as the machine running Capybara.
- Port **1883** free on that machine (stop mosquitto or any other MQTT broker first).

## Getting started

1. Install dependencies:

   ```sh
   bun install
   ```

2. Start the app. This also starts the MQTT broker on port 1883:

   ```sh
   bun run dev
   ```

3. In the clock's MQTT settings, set the broker to **this machine's LAN IP** and port **1883** (no username or password).

4. Open http://localhost:4321. Once the clock has connected, it appears under **MQTT clients** (as `ulanzi_xxxx`). Press one of the animation buttons.

### Configuration

Capybara works without configuration for the clock it was built with. For another clock, set these environment variables (for example in a `.env` file):

| Variable        | Default       | Meaning                                                                                                                                           |
| --------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PIXBAR_PREFIX` | `ulanzi_a834` | The clock's MQTT topic prefix: its `mqtt_prefix` setting plus `_` and the last 4 characters of its MAC address (see `http://<clock-ip>/getBase`). |
| `PIXBAR_APP`    | `capybara`    | Name of the custom app Capybara shows on the clock.                                                                                               |
| `PIXBAR_IP`     | (detected)    | The clock's IP, used for Clear. By default it's taken from the clock's MQTT connection.                                                           |
| `MQTT_PORT`     | `1883`        | Port of the built-in broker.                                                                                                                      |

## Commands

| Command           | What it does                                                                |
| ----------------- | --------------------------------------------------------------------------- |
| `bun run dev`     | Dev server at `localhost:4321`, with the broker                             |
| `bun run build`   | Production build to `dist/`                                                 |
| `bun run start`   | Runs the production build, with the broker                                  |
| `bun run preview` | Builds, then starts                                                         |
| `bun run broker`  | Only the MQTT broker (`--verbose` logs every message)                       |
| `bun run unicorn` | Streams the unicorn from the command line (`--serve` starts its own broker) |
| `bun run check`   | Lint, typecheck, formatting check and tests                                 |
| `bun run fallow`  | Checks changed files for dead code, duplication and complexity              |

## How it works

The clock connects to Capybara's broker and listens on two MQTT topics:

- `<prefix>/custom/<app>`: content for a custom app. Each message is one JSON frame, for example a full-screen bitmap. The first frame creates the app.
- `<prefix>/switchDiyApp`: a custom app's name, which brings that app to the front.

Capybara publishes frames to its app's topic and sends the switch when an animation starts. Removing an app only works through the clock's HTTP API, so Clear uses that.

Everything runs in a single Bun process: Astro (with the Node adapter, executed by Bun) serves the page, and the broker runs alongside it.

```text
src/
├── actions/index.ts          Astro Actions behind the buttons
├── integrations/pixbar.ts    starts the broker with the dev server
├── lib/
│   ├── mqtt/                 broker, client, packet codec, topic matching
│   ├── pixbar/               display constants and frame types, streaming,
│   │                         the clock's HTTP API, animations
│   └── server/display.ts     owns the broker and what's playing
└── pages/index.astro         the control page
scripts/                      production server entry and CLI tools
```

## Roadmap

- **Drawing**: a pixel editor in the browser that sends drawings to the clock.
- **Device insight**: status, what's currently showing, and live previews of frames.
- **Several apps**: manage multiple custom apps from the UI and switch between them.
- **Integrations**: apps fed by other services, such as weather and social media stats, updated on a schedule.

## Security

The broker is meant for your home network only. It has no authentication and no encryption. Don't expose port 1883 (or the web app) to the internet.

## Development

Contributor and agent notes, including device details and the checks to run after each change, live in [AGENTS.md](AGENTS.md).

The clock's stock firmware isn't officially documented. Much of what Capybara relies on comes from the community's reverse-engineering notes in [atomicstack/tc002-customisation](https://github.com/atomicstack/tc002-customisation).
