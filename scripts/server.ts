#!/usr/bin/env bun
/**
 * Production entry (`bun run start`, after `bun run build`): starts the MQTT
 * broker, then Astro's standalone server, both in one Bun process.
 */
import { display, shutdownDisplay } from '../src/lib/server/display'

display()

// Built output, so it's resolved at runtime rather than type-checked.
const entry = new URL('../dist/server/entry.mjs', import.meta.url).href
await import(entry)

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    shutdownDisplay()
    process.exit(0)
  })
}
