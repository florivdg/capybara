#!/usr/bin/env bun
/**
 * Standalone MQTT broker for the PixBar (replaces mosquitto).
 * LAN-only, no auth — don't expose this to the internet.
 *
 *   bun run broker [--host 0.0.0.0] [--port 1883] [--verbose]
 */
import { parseArgs } from 'node:util'
import { Broker } from '../src/lib/mqtt/broker'
import { DEFAULT_PORT } from '../src/lib/mqtt/packets'

const { values: args } = parseArgs({
  options: {
    host: { type: 'string', default: '0.0.0.0' },
    port: { type: 'string', default: String(DEFAULT_PORT) },
    verbose: { type: 'boolean', short: 'v', default: false },
  },
})

const broker = new Broker({
  hostname: args.host,
  port: Number(args.port),
  log: console.log,
}).listen()
console.log(`MQTT broker listening on ${args.host}:${broker.port}`)

if (args.verbose) {
  broker.subscribe('#', ({ topic, payload, retain }) =>
    console.log(
      `${topic} (${payload.length} bytes${retain ? ', retained' : ''})`,
    ),
  )
}

process.on('SIGINT', () => {
  broker.stop()
  process.exit(0)
})
