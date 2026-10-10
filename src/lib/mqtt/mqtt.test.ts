import { afterEach, describe, expect, test } from 'bun:test'
import { Broker } from './broker'
import { MqttClient } from './client'
import {
  MqttProtocolError,
  PacketParser,
  encodePacket,
  toBytes,
  type ConnackPacket,
  type Message,
  type ConnectPacket,
  type Packet,
  type PublishPacket,
} from './packets'
import { isValidTopicFilter, topicMatches } from './topics'

const roundTrip = (packet: Packet) =>
  new PacketParser().push(encodePacket(packet))

const nextMessage = (client: MqttClient) =>
  new Promise<Message>((resolve) => {
    const off = client.onMessage((m) => {
      off()
      resolve(m)
    })
  })

const text = (m: Message) => new TextDecoder().decode(m.payload)

const ACCEPTED: ConnackPacket = {
  type: 'connack',
  sessionPresent: false,
  returnCode: 0,
}

/** A bare TCP connection that speaks packets by hand, for things MqttClient won't do. */
async function rawConnect(port: number, connect: Partial<ConnectPacket> = {}) {
  const received: Packet[] = []
  let wake: (() => void) | undefined
  const closed = Promise.withResolvers<void>()
  const parser = new PacketParser()
  const socket = await Bun.connect({
    hostname: '127.0.0.1',
    port,
    socket: {
      data: (_s, chunk) => {
        received.push(...parser.push(chunk))
        wake?.()
      },
      close: () => closed.resolve(),
    },
  })
  /** The next packet from the broker, in arrival order. */
  const next = async (): Promise<Packet | undefined> => {
    while (!received.length) await new Promise<void>((r) => (wake = r))
    return received.shift()
  }
  const send = (packet: Packet) => socket.write(encodePacket(packet))
  send({
    type: 'connect',
    protocolName: 'MQTT',
    protocolLevel: 4,
    clientId: 'raw',
    cleanSession: true,
    keepAlive: 0,
    ...connect,
  })
  return { socket, send, next, closed: closed.promise }
}

describe('packets', () => {
  test.each<Packet>([
    {
      type: 'connect',
      protocolName: 'MQTT',
      protocolLevel: 4,
      clientId: 'pixbar',
      cleanSession: true,
      keepAlive: 60,
      will: {
        topic: 'pixbar/status',
        payload: toBytes('offline'),
        qos: 1,
        retain: true,
      },
      username: 'user',
      password: toBytes('secret'),
    },
    { type: 'connack', sessionPresent: false, returnCode: 0 },
    {
      type: 'publish',
      topic: 'a/b',
      payload: new Uint8Array(300),
      qos: 0,
      retain: true,
      dup: false,
      packetId: undefined,
    },
    {
      type: 'publish',
      topic: 'a/b',
      payload: Uint8Array.of(1, 2),
      qos: 1,
      retain: false,
      dup: true,
      packetId: 42,
    },
    { type: 'pubrel', packetId: 7 },
    {
      type: 'subscribe',
      packetId: 1,
      subscriptions: [
        { filter: 'a/+', qos: 1 },
        { filter: '#', qos: 0 },
      ],
    },
    { type: 'suback', packetId: 1, granted: [1, 0x80] },
    { type: 'unsubscribe', packetId: 2, filters: ['a/+'] },
    { type: 'pingreq' },
    { type: 'disconnect' },
  ])('round-trips $type', (packet) => {
    expect(roundTrip(packet)).toEqual([packet])
  })

  test('reassembles packets split across chunks', () => {
    const bytes = new Uint8Array([
      ...encodePacket({
        type: 'publish',
        topic: 't',
        payload: new Uint8Array(20_000),
        qos: 0,
        retain: false,
        dup: false,
      }),
      ...encodePacket({ type: 'pingreq' }),
    ])
    const parser = new PacketParser()
    const packets = []
    for (let i = 0; i < bytes.length; i += 1000)
      packets.push(...parser.push(bytes.subarray(i, i + 1000)))
    expect(packets.map((p) => p.type)).toEqual(['publish', 'pingreq'])
  })

  test('rejects oversized packets before buffering them', () => {
    const bytes = encodePacket({
      type: 'publish',
      topic: 't',
      payload: new Uint8Array(5000),
      qos: 0,
      retain: false,
      dup: false,
    })
    expect(() => new PacketParser(1024).push(bytes.subarray(0, 10))).toThrow(
      MqttProtocolError,
    )
  })

  test('rejects malformed packets', () => {
    expect(() =>
      new PacketParser().push(Uint8Array.of(0x82, 0x02, 0, 1)),
    ).toThrow(/SUBSCRIBE is empty/)
    expect(() => new PacketParser().push(Uint8Array.of(0xc1, 0x00))).toThrow(
      /Invalid flags/,
    )
    expect(() =>
      new PacketParser().push(
        Uint8Array.of(0x30, 0xff, 0xff, 0xff, 0xff, 0x7f),
      ),
    ).toThrow(/remaining length/)
  })
})

describe('topics', () => {
  test.each([
    ['a/b', 'a/b', true],
    ['a/+', 'a/b', true],
    ['a/+', 'a/b/c', false],
    ['a/#', 'a', true],
    ['a/#', 'a/b/c', true],
    ['+/+', '/x', true],
    ['#', '$SYS/uptime', false],
    ['$SYS/#', '$SYS/uptime', true],
  ])('%s matches %s: %p', (filter, topic, expected) => {
    expect(topicMatches(filter, topic)).toBe(expected)
  })

  test('validates filters', () => {
    expect(['#', 'a/+/b', '+', 'a/#'].every(isValidTopicFilter)).toBe(true)
    expect(['', 'a/#/b', 'a+', 'a/b#'].some(isValidTopicFilter)).toBe(false)
  })
})

describe('broker', () => {
  let broker: Broker
  const clients: MqttClient[] = []
  const connect = async (clientId?: string) => {
    const client = await MqttClient.connect({ port: broker.port, clientId })
    clients.push(client)
    return client
  }
  afterEach(() => {
    for (const client of clients.splice(0)) client.end()
    broker?.stop()
  })

  const start = () =>
    (broker = new Broker({ hostname: '127.0.0.1', port: 0 }).listen())

  test('routes publishes to matching subscribers', async () => {
    start()
    const [sub, pub] = await Promise.all([connect(), connect()])
    expect(await sub.subscribe('ulanzi_a834/custom/+', 1)).toEqual([1])
    const received = nextMessage(sub)
    await pub.publish('ulanzi_a834/custom/mqtt', '{"duration":5}', { qos: 1 })
    const message = await received
    expect(message.topic).toBe('ulanzi_a834/custom/mqtt')
    expect(text(message)).toBe('{"duration":5}')
    expect(message.retain).toBe(false)
  })

  test('delivers large frames intact', async () => {
    start()
    const [sub, pub] = await Promise.all([connect(), connect()])
    await sub.subscribe('big')
    const received = nextMessage(sub)
    const payload = crypto.getRandomValues(new Uint8Array(500_000))
    await pub.publish('big', payload, { qos: 1 })
    expect((await received).payload).toEqual(payload)
  })

  test('stops delivering after unsubscribe', async () => {
    start()
    const sub = await connect()
    await sub.subscribe(['a', 'b'])
    await sub.unsubscribe('a')
    const received = nextMessage(sub)
    broker.publish('a', 'dropped')
    broker.publish('b', 'kept')
    expect((await received).topic).toBe('b')
  })

  test('replays retained messages to new subscribers', async () => {
    start()
    broker.publish('pixbar/status', 'online', { retain: true })
    const sub = await connect()
    const received = nextMessage(sub)
    await sub.subscribe('pixbar/#')
    const message = await received
    expect([text(message), message.retain]).toEqual(['online', true])
  })

  test('in-process subscribers see client publishes', async () => {
    start()
    const pub = await connect('clock')
    const received = new Promise<Message>((resolve) =>
      broker.subscribe('stats', resolve),
    )
    await pub.publish('stats', '42', { qos: 1 })
    expect(text(await received)).toBe('42')
    expect(broker.clientIds).toEqual(['clock'])
  })

  test('publishes the will when a client drops', async () => {
    start()
    const sub = await connect()
    await sub.subscribe('will')
    const received = nextMessage(sub)
    const doomed = await rawConnect(broker.port!, {
      will: {
        topic: 'will',
        payload: toBytes('gone'),
        qos: 0,
        retain: false,
      },
    })
    expect(await doomed.next()).toEqual(ACCEPTED)
    doomed.socket.terminate()
    expect(text(await received)).toBe('gone')
  })

  test('refuses unsupported protocol versions', async () => {
    start()
    const { socket, next } = await rawConnect(broker.port!, {
      protocolLevel: 5,
    })
    expect(await next()).toEqual({ ...ACCEPTED, returnCode: 1 })
    socket.end()
  })

  test('delivers QoS 2 publishes exactly once', async () => {
    start()
    const delivered: string[] = []
    broker.subscribe('q2', (m) => delivered.push(text(m)))
    const { socket, send, next } = await rawConnect(broker.port!)
    expect(await next()).toEqual(ACCEPTED)

    const publish: PublishPacket = {
      type: 'publish',
      topic: 'q2',
      payload: toBytes('once'),
      qos: 2,
      retain: false,
      dup: false,
      packetId: 9,
    }
    send(publish)
    send({ ...publish, dup: true }) // redelivered before PUBREL
    send({ type: 'pubrel', packetId: 9 })
    expect([await next(), await next(), await next()]).toEqual([
      { type: 'pubrec', packetId: 9 },
      { type: 'pubrec', packetId: 9 },
      { type: 'pubcomp', packetId: 9 },
    ])
    expect(delivered).toEqual(['once'])
    socket.end()
  })

  test('answers pings and drops clients that send server packets', async () => {
    start()
    const { send, next, closed } = await rawConnect(broker.port!)
    expect(await next()).toEqual(ACCEPTED)
    send({ type: 'pingreq' })
    expect(await next()).toEqual({ type: 'pingresp' })

    send({ type: 'suback', packetId: 1, granted: [0] })
    await closed
    expect(broker.clientIds).toEqual([])
  })
})
