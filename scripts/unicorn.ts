#!/usr/bin/env bun
/**
 * A unicorn galloping back and forth across the PixBar, streamed over MQTT.
 *
 * Each tick renders the full 52×16 frame locally and pushes it as one `db`
 * bitmap to <prefix>/custom/<app>. Ctrl-C to stop.
 *
 *   bun run unicorn [--broker localhost] [--port 1883] [--prefix ulanzi_a834]
 *                   [--app mqtt] [--fps 8] [--seconds 0] [--serve]
 *
 * --serve runs the broker in-process instead of connecting to one, so this
 * one command is all the clock needs.
 */
import { parseArgs } from 'node:util'
import { Broker } from '../src/lib/mqtt/broker'
import { MqttClient } from '../src/lib/mqtt/client'
import { DEFAULT_PORT } from '../src/lib/mqtt/packets'
import { createUnicorn } from '../src/lib/pixbar/animations/unicorn'
import { DEFAULT_PREFIX, customAppTopic } from '../src/lib/pixbar/display'
import { streamApp, type Publish } from '../src/lib/pixbar/stream'

const { values: args } = parseArgs({
  options: {
    broker: { type: 'string', default: 'localhost' },
    port: { type: 'string', default: String(DEFAULT_PORT) },
    prefix: { type: 'string', default: DEFAULT_PREFIX },
    app: { type: 'string', default: 'mqtt' },
    fps: { type: 'string', default: '8' },
    seconds: { type: 'string', default: '0' },
    serve: { type: 'boolean', default: false },
  },
})

const port = Number(args.port)
const fps = Number(args.fps)
const seconds = Number(args.seconds)
if (!(fps > 0))
  throw new Error(`--fps must be a positive number, got ${args.fps}`)
const stop = new AbortController()
let publish: Publish
let shutdown: () => void

if (args.serve) {
  const broker = new Broker({ port, log: console.log }).listen()
  console.log(`MQTT broker listening on 0.0.0.0:${broker.port}`)
  publish = (topic, payload) => broker.publish(topic, payload)
  shutdown = () => broker.stop()
} else {
  const client = await MqttClient.connect({ host: args.broker, port })
  client.onClose((error) => {
    if (error) console.error(`MQTT connection lost: ${error.message}`)
    stop.abort()
  })
  publish = (topic, payload) => void client.publish(topic, payload)
  shutdown = () => client.end()
}

process.on('SIGINT', () => stop.abort())
if (seconds) setTimeout(() => stop.abort(), seconds * 1000).unref()

const stream = streamApp(publish, createUnicorn(), {
  prefix: args.prefix,
  app: args.app,
  fps,
})
console.log(
  `Streaming unicorn to ${customAppTopic(args.prefix, args.app)} at ${fps} fps (Ctrl-C to stop)`,
)
await new Promise((resolve) =>
  stop.signal.addEventListener('abort', resolve, { once: true }),
)
stream.stop()
shutdown()
