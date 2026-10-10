import type { Socket, TCPSocketListener } from 'bun'
import {
  ConnectReturnCode,
  DEFAULT_PORT,
  MqttProtocolError,
  PacketParser,
  SUBACK_FAILURE,
  encodePacket,
  minQos,
  toBytes,
  toMessage,
  type ConnectPacket,
  type Message,
  type MessageHandler,
  type Packet,
  type PublishPacket,
  type QoS,
  type SubscribePacket,
  type Will,
} from './packets'
import { SocketWriter } from './socket-writer'
import { isValidTopicFilter, isValidTopicName, topicMatches } from './topics'

export type SubscribeHandler = (clientId: string, filters: string[]) => void

export interface BrokerOptions {
  /** Default 0.0.0.0 so devices on the LAN (the clock) can reach it. */
  hostname?: string
  /** Default 1883; 0 picks a free port (see `broker.port`). */
  port?: number
  /** Default 1 MiB. A full 52×16 `db` bitmap frame is ~7 KiB. */
  maxPacketSize?: number
  log?: (message: string) => void
}

/** Clients must send CONNECT within this long of opening the socket. */
const CONNECT_TIMEOUT_MS = 10_000

/** Packets only a server sends; a client sending one is a protocol violation. */
const SERVER_ONLY = new Set<Packet['type']>([
  'connack',
  'suback',
  'unsuback',
  'pingresp',
])

/** The CONNACK code to refuse a CONNECT with, if it must be refused. */
function connectRefusal(packet: ConnectPacket): number | undefined {
  const { protocolName, protocolLevel } = packet
  const supported =
    (protocolName === 'MQTT' && protocolLevel === 4) ||
    (protocolName === 'MQIsdp' && protocolLevel === 3)
  if (!supported) return ConnectReturnCode.UnacceptableProtocolVersion
  if (!packet.clientId && !packet.cleanSession)
    return ConnectReturnCode.IdentifierRejected
  return undefined
}

/** Overlapping subscriptions get one copy, at the highest granted QoS. */
function subscribedQos(conn: Connection, topic: string): QoS | undefined {
  let qos: QoS | undefined
  for (const [filter, granted] of conn.subscriptions) {
    const higher = qos === undefined || granted > qos
    if (higher && topicMatches(filter, topic)) qos = granted
  }
  return qos
}

class Connection {
  readonly parser: PacketParser
  readonly writer: SocketWriter
  readonly openedAt = Date.now()
  lastActivity = Date.now()
  clientId?: string
  keepAliveMs = 0
  will?: Will
  closing = false
  readonly subscriptions = new Map<string, QoS>()
  /** Inbound QoS 2 packet ids we've PUBREC'd but not yet seen PUBREL for. */
  readonly pendingQos2 = new Set<number>()
  private lastPacketId = 0

  constructor(
    readonly socket: Socket<Connection>,
    maxPacketSize: number,
  ) {
    this.parser = new PacketParser(maxPacketSize)
    this.writer = new SocketWriter(socket)
  }

  get label() {
    return this.clientId ?? `${this.socket.remoteAddress} (connecting)`
  }

  send(packet: Packet) {
    if (!this.closing) this.writer.write(encodePacket(packet))
  }

  nextPacketId() {
    this.lastPacketId = (this.lastPacketId % 0xffff) + 1
    return this.lastPacketId
  }

  close() {
    this.closing = true
    this.socket.end()
  }
}

/**
 * A small MQTT 3.1.1 broker on Bun's TCP sockets — enough to replace
 * mosquitto for the PixBar on a LAN. No auth, no TLS.
 *
 * Sessions are not persisted: every connection behaves like a clean
 * session. QoS 0 and 1 are delivered; QoS 2 publishes are accepted
 * (exactly-once inbound) and forwarded at QoS 1 at most. Outbound QoS 1
 * messages aren't retried.
 *
 * Besides TCP clients, the app itself can `publish` and `subscribe`
 * in-process without a socket.
 */
export class Broker {
  private server?: TCPSocketListener<Connection>
  private timer?: ReturnType<typeof setInterval>
  private readonly connections = new Set<Connection>()
  private readonly sessions = new Map<string, Connection>()
  private readonly retained = new Map<string, Message>()
  private readonly listeners = new Set<{
    filter: string
    handler: MessageHandler
  }>()
  private readonly subscribeHandlers = new Set<SubscribeHandler>()

  constructor(private readonly options: BrokerOptions = {}) {}

  /**
   * Called after a TCP client's SUBSCRIBE is acknowledged, with the filters it
   * was granted, e.g. to re-send state a device has only now started
   * listening for. Returns a function that removes the handler.
   */
  onSubscribed(handler: SubscribeHandler): () => void {
    this.subscribeHandlers.add(handler)
    return () => this.subscribeHandlers.delete(handler)
  }

  get port(): number | undefined {
    return this.server?.port
  }

  /** Ids of the clients currently connected over TCP. */
  get clientIds(): string[] {
    return [...this.sessions.keys()]
  }

  /** The IP a connected client talks to us from, e.g. to reach a device's HTTP API. */
  clientAddress(clientId: string): string | undefined {
    return this.sessions
      .get(clientId)
      ?.socket.remoteAddress.replace(/^::ffff:/, '')
  }

  listen(): this {
    if (this.server) throw new Error('Broker already listening')
    const maxPacketSize = this.options.maxPacketSize ?? 1024 * 1024
    this.server = Bun.listen<Connection>({
      hostname: this.options.hostname ?? '0.0.0.0',
      port: this.options.port ?? DEFAULT_PORT,
      socket: {
        open: (socket) => {
          socket.data = new Connection(socket, maxPacketSize)
          this.connections.add(socket.data)
        },
        data: (socket, chunk) => this.onData(socket.data, chunk),
        drain: (socket) => socket.data.writer.flush(),
        close: (socket) => this.onClose(socket.data),
        error: (socket, error) =>
          this.log(`${socket.data.label}: ${error.message}`),
      },
    })
    this.timer = setInterval(() => this.checkTimeouts(), 1000)
    return this
  }

  stop(): void {
    clearInterval(this.timer)
    for (const conn of this.connections) {
      conn.will = undefined
      conn.close()
    }
    this.server?.stop(true)
    this.server = undefined
  }

  /** Publish from inside the app, as if a client had sent it. */
  publish(
    topic: string,
    payload: string | Uint8Array,
    { qos = 0, retain = false }: { qos?: QoS; retain?: boolean } = {},
  ) {
    if (!isValidTopicName(topic))
      throw new Error(`Invalid topic name: ${topic}`)
    this.route({ topic, payload: toBytes(payload), qos, retain })
  }

  /** Listen in-process to every message matching `filter`. Returns an unsubscribe function. */
  subscribe(filter: string, handler: MessageHandler): () => void {
    if (!isValidTopicFilter(filter))
      throw new Error(`Invalid topic filter: ${filter}`)
    const listener = { filter, handler }
    this.listeners.add(listener)
    for (const message of this.retained.values()) {
      if (topicMatches(filter, message.topic)) this.notify(listener, message)
    }
    return () => this.listeners.delete(listener)
  }

  private log(message: string) {
    this.options.log?.(message)
  }

  private onData(conn: Connection, chunk: Uint8Array) {
    conn.lastActivity = Date.now()
    try {
      for (const packet of conn.parser.push(chunk)) {
        if (conn.closing) return
        this.handle(conn, packet)
      }
    } catch (error) {
      if (!(error instanceof MqttProtocolError)) throw error
      this.log(`${conn.label}: protocol error, disconnecting: ${error.message}`)
      conn.close()
    }
  }

  // fallow-ignore-next-line complexity -- One flat case per packet type; the dispatch reads best as a single switch.
  private handle(conn: Connection, packet: Packet) {
    if (!conn.clientId && packet.type !== 'connect') {
      throw new MqttProtocolError(
        `Expected CONNECT, got ${packet.type.toUpperCase()}`,
      )
    }
    if (SERVER_ONLY.has(packet.type)) {
      throw new MqttProtocolError(
        `Clients may not send ${packet.type.toUpperCase()}`,
      )
    }
    switch (packet.type) {
      case 'connect':
        return this.onConnect(conn, packet)
      case 'publish':
        return this.onPublish(conn, packet)
      case 'pubrel':
        conn.pendingQos2.delete(packet.packetId)
        return conn.send({ type: 'pubcomp', packetId: packet.packetId })
      case 'subscribe':
        return this.onSubscribe(conn, packet)
      case 'unsubscribe':
        for (const filter of packet.filters) conn.subscriptions.delete(filter)
        return conn.send({ type: 'unsuback', packetId: packet.packetId })
      case 'pingreq':
        return conn.send({ type: 'pingresp' })
      case 'disconnect':
        conn.will = undefined // clean disconnect: don't publish the will
        return conn.close()
      default:
        return // PUBACK/PUBREC/PUBCOMP: we don't retry outbound messages, so acks need no bookkeeping
    }
  }

  private onConnect(conn: Connection, packet: ConnectPacket) {
    if (conn.clientId)
      throw new MqttProtocolError('Second CONNECT on one connection')

    if (packet.will && !isValidTopicName(packet.will.topic)) {
      throw new MqttProtocolError(`Invalid will topic: ${packet.will.topic}`)
    }
    const refusal = connectRefusal(packet)
    if (refusal !== undefined) return this.refuse(conn, refusal)

    // connectRefusal only lets an empty id through for clean sessions.
    const clientId = packet.clientId || `auto-${crypto.randomUUID()}`
    this.dropSession(clientId)
    conn.clientId = clientId
    conn.keepAliveMs = packet.keepAlive * 1000
    conn.will = packet.will
    this.sessions.set(clientId, conn)
    conn.send({
      type: 'connack',
      sessionPresent: false,
      returnCode: ConnectReturnCode.Accepted,
    })
    this.log(`${clientId}: connected from ${conn.socket.remoteAddress}`)
  }

  /**
   * MQTT allows one connection per client id: a reconnect replaces the old
   * one. The old connection is often half-open (the device dropped off Wi-Fi),
   * so its close could fire much later; publish its will now, before the new
   * connection's own messages, and cut the socket instead of waiting on it.
   */
  private dropSession(clientId: string) {
    const existing = this.sessions.get(clientId)
    if (!existing) return
    this.log(`${clientId}: connected again, dropping the old connection`)
    this.sessions.delete(clientId)
    const { will } = existing
    existing.will = undefined
    existing.closing = true
    existing.socket.terminate()
    if (will) this.route({ ...will })
  }

  private refuse(conn: Connection, returnCode: number) {
    this.log(`${conn.label}: refused (CONNACK ${returnCode})`)
    conn.send({ type: 'connack', sessionPresent: false, returnCode })
    conn.close()
  }

  private onPublish(conn: Connection, packet: PublishPacket) {
    if (!isValidTopicName(packet.topic))
      throw new MqttProtocolError(`Invalid topic name: ${packet.topic}`)
    const packetId = packet.packetId!
    if (packet.qos === 1) conn.send({ type: 'puback', packetId })
    if (packet.qos === 2) {
      conn.send({ type: 'pubrec', packetId })
      if (conn.pendingQos2.has(packetId)) return // redelivery of a message we already routed
      conn.pendingQos2.add(packetId)
    }
    this.route(toMessage(packet))
  }

  private onSubscribe(conn: Connection, packet: SubscribePacket) {
    const granted = packet.subscriptions.map(({ filter, qos }) => {
      if (!isValidTopicFilter(filter)) return SUBACK_FAILURE
      conn.subscriptions.set(filter, minQos(qos, 1))
      return minQos(qos, 1)
    })
    conn.send({ type: 'suback', packetId: packet.packetId, granted })
    this.log(
      `${conn.label}: subscribed to ${packet.subscriptions.map((s, i) => `${s.filter} (QoS ${granted[i]})`).join(', ')}`,
    )

    const filters: string[] = []
    packet.subscriptions.forEach(({ filter }, i) => {
      const qos = granted[i]
      if (qos === SUBACK_FAILURE) return
      filters.push(filter)
      for (const message of this.retained.values()) {
        if (topicMatches(filter, message.topic))
          this.deliver(conn, message, minQos(qos, message.qos), true)
      }
    })

    for (const handler of this.subscribeHandlers) {
      try {
        handler(conn.label, filters)
      } catch (error) {
        this.log(
          `subscribe handler threw: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
  }

  private route(message: Message) {
    if (message.retain) this.retain(message)

    for (const conn of this.sessions.values()) {
      const qos = subscribedQos(conn, message.topic)
      if (qos !== undefined)
        this.deliver(conn, message, minQos(qos, message.qos), false)
    }
    this.notifyListeners(message)
  }

  private retain(message: Message) {
    // An empty retained payload clears the topic's retained message.
    if (message.payload.length) this.retained.set(message.topic, message)
    else this.retained.delete(message.topic)
  }

  private notifyListeners(message: Message) {
    for (const listener of this.listeners) {
      if (topicMatches(listener.filter, message.topic))
        this.notify(listener, message)
    }
  }

  private notify(
    { filter, handler }: { filter: string; handler: MessageHandler },
    message: Message,
  ) {
    try {
      handler(message)
    } catch (error) {
      this.log(
        `subscriber for ${filter} threw: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  private deliver(
    conn: Connection,
    message: Message,
    qos: QoS,
    retain: boolean,
  ) {
    conn.send({
      type: 'publish',
      topic: message.topic,
      payload: message.payload,
      qos,
      retain,
      dup: false,
      packetId: qos > 0 ? conn.nextPacketId() : undefined,
    })
  }

  private onClose(conn: Connection) {
    this.connections.delete(conn)
    if (!conn.clientId) return
    if (this.sessions.get(conn.clientId) === conn)
      this.sessions.delete(conn.clientId)
    this.log(`${conn.clientId}: disconnected`)
    if (conn.will) this.route({ ...conn.will })
  }

  private checkTimeouts() {
    const now = Date.now()
    for (const conn of this.connections) {
      if (conn.closing) continue
      if (!conn.clientId && now - conn.openedAt > CONNECT_TIMEOUT_MS) {
        this.log(`${conn.label}: no CONNECT received, disconnecting`)
        conn.close()
      } else if (
        conn.keepAliveMs &&
        now - conn.lastActivity > conn.keepAliveMs * 1.5
      ) {
        this.log(`${conn.label}: keep-alive expired, disconnecting`)
        conn.close()
      }
    }
  }
}
