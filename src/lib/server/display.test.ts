import { afterEach, expect, spyOn, test } from 'bun:test'
import { Broker } from '../mqtt/broker'
import { MqttClient } from '../mqtt/client'
import { createUnicorn } from '../pixbar/animations/unicorn'
import { DEFAULT_PREFIX, switchAppTopic } from '../pixbar/display'
import { ClockError } from '../pixbar/http'
import { Display } from './display'

const PREFIX = process.env.PIXBAR_PREFIX ?? DEFAULT_PREFIX
const APP = process.env.PIXBAR_APP ?? 'capybara'

let running: Display | undefined
const clients: MqttClient[] = []
const spies: { mockRestore(): void }[] = []

afterEach(() => {
  for (const client of clients.splice(0)) client.end()
  for (const spy of spies.splice(0)) spy.mockRestore()
  running?.shutdown()
})

function start() {
  const broker = new Broker({ hostname: '127.0.0.1', port: 0 }).listen()
  running = new Display(broker)
  return { broker, display: running }
}

/** Connects like the clock does: its client id is the topic prefix. */
async function connectClock(port: number | undefined) {
  const clock = await MqttClient.connect({ port, clientId: PREFIX })
  clients.push(clock)
  return clock
}

/** Holds the clock's HTTP API answer until the test releases it. */
function holdFetch() {
  const answer = Promise.withResolvers<Response>()
  spies.push(
    spyOn(globalThis, 'fetch').mockImplementation(
      // Bun's fetch type also carries `preconnect`.
      Object.assign(() => answer.promise, { preconnect: () => {} }),
    ),
  )
  return answer
}

test('re-activates a running stream when the clock subscribes late', async () => {
  const { broker, display } = start()
  await display.play('unicorn', createUnicorn()) // nobody is listening yet

  const clock = await connectClock(broker.port)
  const switched = new Promise<string>((resolve) =>
    clock.onMessage(({ topic, payload }) => {
      if (topic === switchAppTopic(PREFIX))
        resolve(new TextDecoder().decode(payload))
    }),
  )
  await clock.subscribe(`${PREFIX}/custom/+`)
  await clock.subscribe(switchAppTopic(PREFIX))

  expect(await switched).toBe(APP)
})

test('other subscribers to the switch topic do not re-activate', async () => {
  const { broker, display } = start()
  await display.play('unicorn', createUnicorn())
  const switches: string[] = []
  broker.subscribe(switchAppTopic(PREFIX), ({ topic }) => switches.push(topic))

  const observer = await MqttClient.connect({ port: broker.port })
  clients.push(observer)
  await observer.subscribe(switchAppTopic(PREFIX))
  expect(switches).toEqual([])
})

test('a Start during a pending Clear waits for the removal', async () => {
  const { broker, display } = start()
  await connectClock(broker.port)
  const frames: string[] = []
  broker.subscribe(`${PREFIX}/custom/+`, ({ topic }) => frames.push(topic))
  const removal = holdFetch()

  const clearing = display.clear()
  const playing = display.play('unicorn', createUnicorn())
  await Bun.sleep(50)
  expect(frames).toEqual([]) // queued behind the HTTP removal

  removal.resolve(new Response('{}'))
  await Promise.all([clearing, playing])
  expect(frames.length).toBeGreaterThan(0)
  expect(display.status().animation).toBe('unicorn')
})

test('a failed Clear does not block later commands', async () => {
  const { broker, display } = start()
  await connectClock(broker.port)
  holdFetch().reject(new TypeError('network down'))

  const error = await display.clear().catch((e: unknown) => e)
  expect(error).toBeInstanceOf(ClockError)
  await display.play('unicorn', createUnicorn())
  expect(display.status().animation).toBe('unicorn')
})
