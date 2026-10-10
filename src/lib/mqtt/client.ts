import type { Socket } from 'bun'
import {
  ConnectReturnCode,
  DEFAULT_PORT,
  PacketParser,
  encodePacket,
  toBytes,
  toMessage,
  type ConnackPacket,
  type MessageHandler,
  type Packet,
  type PublishPacket,
  type QoS,
  type Will,
} from './packets'
import { SocketWriter } from './socket-writer'

export interface ClientOptions {
  host?: string
  port?: number
  /** Default: a random id. */
  clientId?: string
  /** Seconds between pings; 0 disables keep-alive. Default 30. */
  keepAlive?: number
  username?: string
  password?: string
  will?: Will
  /** How long to wait for CONNACK, in ms. Default 5000. */
  connectTimeout?: number
}

interface Pending {
  resolve: (packet: Packet) => void
  reject: (error: Error) => void
}

/**
 * A minimal MQTT 3.1.1 client on Bun's TCP sockets. Publishes at QoS 0 or 1,
 * subscribes at any QoS. No automatic reconnect — watch `onClose`.
 */
export class MqttClient {
  private socket!: Socket
  private writer!: SocketWriter
  private readonly parser = new PacketParser()
  private readonly pending = new Map<number, Pending>()
  private connack?: PromiseWithResolvers<ConnackPacket>
  private readonly handlers = new Set<MessageHandler>()
  private readonly closeHandlers = new Set<(error?: Error) => void>()
  private pingTimer?: ReturnType<typeof setInterval>
  private lastPacketId = 0
  private ended = false
  private closed = false

  private constructor(private readonly options: ClientOptions) {}

  static async connect(options: ClientOptions = {}): Promise<MqttClient> {
    const client = new MqttClient(options)
    await client.open()
    return client
  }

  private async open() {
    const {
      host = 'localhost',
      port = DEFAULT_PORT,
      keepAlive = 30,
    } = this.options
    this.socket = await Bun.connect({
      hostname: host,
      port,
      socket: {
        data: (_socket, chunk) => this.onData(chunk),
        drain: () => this.writer.flush(),
        close: () =>
          this.handleClose(
            this.ended ? undefined : new Error('Connection closed by broker'),
          ),
        error: (_socket, error) => this.handleClose(error),
      },
    })
    this.writer = new SocketWriter(this.socket)

    try {
      await this.handshake(keepAlive)
    } catch (error) {
      this.ended = true
      this.socket.terminate()
      throw error
    }

    if (keepAlive > 0)
      this.pingTimer = setInterval(
        () => this.send({ type: 'pingreq' }),
        (keepAlive * 1000) / 2,
      )
  }

  private async handshake(keepAlive: number) {
    const {
      clientId,
      will,
      username,
      password,
      connectTimeout = 5000,
    } = this.options
    const connack = Promise.withResolvers<ConnackPacket>()
    this.connack = connack
    const timeout = setTimeout(
      () => connack.reject(new Error(`No CONNACK within ${connectTimeout}ms`)),
      connectTimeout,
    )
    this.send({
      type: 'connect',
      protocolName: 'MQTT',
      protocolLevel: 4,
      clientId: clientId ?? `capybara-${crypto.randomUUID().slice(0, 8)}`,
      cleanSession: true,
      keepAlive,
      will,
      username,
      password: password === undefined ? undefined : toBytes(password),
    })

    try {
      const { returnCode } = await connack.promise
      if (returnCode !== ConnectReturnCode.Accepted)
        throw new Error(`Broker refused connection (CONNACK ${returnCode})`)
    } finally {
      clearTimeout(timeout)
      this.connack = undefined
    }
  }

  /** Resolves once sent (QoS 0) or acknowledged by the broker (QoS 1). */
  async publish(
    topic: string,
    payload: string | Uint8Array,
    { qos = 0, retain = false }: { qos?: 0 | 1; retain?: boolean } = {},
  ): Promise<void> {
    const base = { topic, payload: toBytes(payload), retain, dup: false }
    if (qos === 0) return this.send({ type: 'publish', ...base, qos })

    const packetId = this.nextPacketId()
    this.send({ type: 'publish', ...base, qos, packetId })
    await this.await(packetId)
  }

  /** Resolves with the granted QoS per filter (0x80 = refused). */
  async subscribe(filters: string | string[], qos: QoS = 0): Promise<number[]> {
    const packetId = this.nextPacketId()
    const subscriptions = [filters].flat().map((filter) => ({ filter, qos }))
    this.send({ type: 'subscribe', packetId, subscriptions })
    const ack = await this.await(packetId)
    return ack.type === 'suback' ? ack.granted : []
  }

  async unsubscribe(filters: string | string[]): Promise<void> {
    const packetId = this.nextPacketId()
    this.send({ type: 'unsubscribe', packetId, filters: [filters].flat() })
    await this.await(packetId)
  }

  /** Returns a function that removes the handler. */
  onMessage(handler: MessageHandler): () => void {
    this.handlers.add(handler)
    return () => this.handlers.delete(handler)
  }

  /** `error` is undefined after a deliberate `end()`. */
  onClose(handler: (error?: Error) => void): () => void {
    this.closeHandlers.add(handler)
    return () => this.closeHandlers.delete(handler)
  }

  end(): void {
    if (this.closed) return
    this.ended = true
    this.send({ type: 'disconnect' })
    this.socket.end()
  }

  private send(packet: Packet) {
    if (this.closed) throw new Error('MQTT connection is closed')
    this.writer.write(encodePacket(packet))
  }

  private nextPacketId() {
    do this.lastPacketId = (this.lastPacketId % 0xffff) + 1
    while (this.pending.has(this.lastPacketId))
    return this.lastPacketId
  }

  /**
   * Register only after `send`: if it throws (connection closed) nothing is
   * left pending, and an ack can't arrive before this runs since socket data
   * is delivered on a later tick.
   */
  private await(packetId: number) {
    return new Promise<Packet>((resolve, reject) =>
      this.pending.set(packetId, { resolve, reject }),
    )
  }

  private onData(chunk: Uint8Array) {
    let packets: Packet[]
    try {
      packets = this.parser.push(chunk)
    } catch (error) {
      this.handleClose(
        error instanceof Error ? error : new Error(String(error)),
      )
      this.socket.terminate()
      return
    }
    for (const packet of packets) this.handle(packet)
  }

  private handle(packet: Packet) {
    switch (packet.type) {
      case 'connack':
        return this.connack?.resolve(packet)
      case 'publish':
        return this.onPublish(packet)
      case 'pubrel':
        return this.send({ type: 'pubcomp', packetId: packet.packetId })
      case 'puback':
      case 'suback':
      case 'unsuback':
        this.pending.get(packet.packetId)?.resolve(packet)
        this.pending.delete(packet.packetId)
        return
      default:
        return // PINGRESP; brokers send nothing else to clients
    }
  }

  private onPublish(packet: PublishPacket) {
    const { qos, packetId } = packet
    // QoS 2 is acknowledged with PUBREC and then completed on PUBREL.
    if (packetId !== undefined)
      this.send({ type: qos === 1 ? 'puback' : 'pubrec', packetId })
    const message = toMessage(packet)
    // A throwing handler mustn't drop the rest of the chunk's packets (acks included).
    for (const handler of this.handlers) {
      try {
        handler(message)
      } catch (error) {
        console.error('MQTT message handler threw:', error)
      }
    }
  }

  private handleClose(error?: Error) {
    if (this.closed) return
    this.closed = true
    clearInterval(this.pingTimer)
    const reason = error ?? new Error('MQTT connection closed')
    this.connack?.reject(reason)
    for (const { reject } of this.pending.values()) reject(reason)
    this.pending.clear()
    for (const handler of this.closeHandlers) handler(error)
  }
}
