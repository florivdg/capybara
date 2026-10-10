import { Broker } from '../mqtt/broker'
import { DEFAULT_PORT } from '../mqtt/packets'
import { topicMatches } from '../mqtt/topics'
import {
  DEFAULT_PREFIX,
  customAppTopic,
  switchAppTopic,
} from '../pixbar/display'
import { ClockError, removeCustomApp } from '../pixbar/http'
import { streamApp, type Animation, type Stream } from '../pixbar/stream'

const PREFIX = process.env.PIXBAR_PREFIX ?? DEFAULT_PREFIX
const APP = process.env.PIXBAR_APP ?? 'capybara'
const MQTT_PORT = Number(process.env.MQTT_PORT ?? DEFAULT_PORT)
/** Otherwise taken from the clock's MQTT connection, whose client id is the prefix. */
const CLOCK_IP = process.env.PIXBAR_IP
const FPS = 8

export interface DisplayStatus {
  /** Name of the animation streaming right now, if any. */
  animation: string | null
  /** MQTT clients connected to the broker; the clock is one of them. */
  clients: string[]
  topic: string
}

/** Owns the broker and whatever is currently streaming to the PixBar. */
export class Display {
  private playing?: { name: string; stream: Stream }
  /** Tail of the command queue; see `exclusive`. */
  private pending: Promise<unknown> = Promise.resolve()

  constructor(private readonly broker: Broker) {
    const switchTopic = switchAppTopic(PREFIX)
    broker.onSubscribed((clientId, filters) => {
      // The clock (its client id is the prefix) just (re)subscribed, so it
      // missed the running stream's switch. Other subscribers don't count.
      if (
        clientId === PREFIX &&
        filters.some((filter) => topicMatches(filter, switchTopic))
      )
        this.playing?.stream.activate()
    })
  }

  /** Streams `animation` into our custom app and brings it on screen. */
  play(name: string, animation: Animation): Promise<void> {
    return this.exclusive(() => {
      this.halt()
      const stream = streamApp(
        (topic, payload) => this.broker.publish(topic, payload),
        animation,
        { prefix: PREFIX, app: APP, fps: FPS },
      )
      this.playing = { name, stream }
    })
  }

  /** Stops streaming; the last frame stays up until its duration runs out. */
  stop(): Promise<void> {
    return this.exclusive(() => this.halt())
  }

  /** Stops streaming and removes our custom app, so the clock goes back to its own apps. */
  clear(): Promise<void> {
    return this.exclusive(async () => {
      const ip = CLOCK_IP ?? this.broker.clientAddress(PREFIX)
      if (!ip) {
        throw new ClockError(
          `The clock (${PREFIX}) isn't connected to the broker and PIXBAR_IP isn't set`,
        )
      }
      this.halt()
      await removeCustomApp(ip, APP)
    })
  }

  status(): DisplayStatus {
    return {
      animation: this.playing?.name ?? null,
      clients: this.broker.clientIds,
      topic: customAppTopic(PREFIX, APP),
    }
  }

  shutdown(): void {
    this.halt()
    this.broker.stop()
  }

  private halt() {
    this.playing?.stream.stop()
    this.playing = undefined
  }

  /**
   * Runs commands one at a time. Otherwise a Start clicked while a Clear is
   * still waiting on the clock's HTTP API could publish first, and the late
   * removal would delete the new stream's app.
   */
  private exclusive<T>(command: () => T | Promise<T>): Promise<T> {
    const result = this.pending.then(command)
    this.pending = result.catch(() => {})
    return result
  }
}

// In dev this module is loaded twice: by the Astro integration and again by
// Vite's SSR module runner. Keeping the instance on globalThis makes both
// copies share one broker instead of fighting over port 1883.
declare global {
  var capybaraDisplay: Display | undefined
}

/** The running display, starting the MQTT broker on first use. */
export function display(log: (message: string) => void = console.log): Display {
  globalThis.capybaraDisplay ??= new Display(
    new Broker({ port: MQTT_PORT, log }).listen(),
  )
  return globalThis.capybaraDisplay
}

export function shutdownDisplay(): void {
  globalThis.capybaraDisplay?.shutdown()
  globalThis.capybaraDisplay = undefined
}
