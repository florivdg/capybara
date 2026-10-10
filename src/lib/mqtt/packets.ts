/**
 * MQTT 3.1.1 packet codec (OASIS spec, protocol level 4). CONNECTs using the
 * older 3.1 protocol ("MQIsdp", level 3) decode too, since some ESP firmwares
 * still send them.
 */

export type QoS = 0 | 1 | 2

/** The standard MQTT port. */
export const DEFAULT_PORT = 1883

/** An application message: what a PUBLISH carries, and what a will publishes. */
export interface Message {
  topic: string
  payload: Uint8Array
  qos: QoS
  retain: boolean
}

export type MessageHandler = (message: Message) => void

export type Will = Message

export interface ConnectPacket {
  type: 'connect'
  protocolName: string
  protocolLevel: number
  clientId: string
  cleanSession: boolean
  /** Seconds; 0 disables the keep-alive check. */
  keepAlive: number
  will?: Will
  username?: string
  password?: Uint8Array
}

export interface ConnackPacket {
  type: 'connack'
  sessionPresent: boolean
  returnCode: number
}

export interface PublishPacket {
  type: 'publish'
  topic: string
  payload: Uint8Array
  qos: QoS
  retain: boolean
  dup: boolean
  /** Present iff qos > 0. */
  packetId?: number
}

export interface AckPacket {
  type: 'puback' | 'pubrec' | 'pubrel' | 'pubcomp' | 'unsuback'
  packetId: number
}

export interface SubscribePacket {
  type: 'subscribe'
  packetId: number
  subscriptions: { filter: string; qos: QoS }[]
}

export interface SubackPacket {
  type: 'suback'
  packetId: number
  /** Granted QoS per subscription, or 0x80 for failure. */
  granted: number[]
}

export interface UnsubscribePacket {
  type: 'unsubscribe'
  packetId: number
  filters: string[]
}

export interface EmptyPacket {
  type: 'pingreq' | 'pingresp' | 'disconnect'
}

export type Packet =
  | ConnectPacket
  | ConnackPacket
  | PublishPacket
  | AckPacket
  | SubscribePacket
  | SubackPacket
  | UnsubscribePacket
  | EmptyPacket

export const ConnectReturnCode = {
  Accepted: 0,
  UnacceptableProtocolVersion: 1,
  IdentifierRejected: 2,
  ServerUnavailable: 3,
  BadCredentials: 4,
  NotAuthorized: 5,
} as const

export const SUBACK_FAILURE = 0x80

/** Largest value the 4-byte "remaining length" field can encode. */
const MAX_REMAINING_LENGTH = 268_435_455

export class MqttProtocolError extends Error {
  override name = 'MqttProtocolError'
}

type PacketType = Packet['type']

/** Indexed by packet type code - 1 (CONNECT = 1 … DISCONNECT = 14). */
const PACKET_TYPES: readonly PacketType[] = [
  'connect',
  'connack',
  'publish',
  'puback',
  'pubrec',
  'pubrel',
  'pubcomp',
  'subscribe',
  'suback',
  'unsubscribe',
  'unsuback',
  'pingreq',
  'pingresp',
  'disconnect',
]

/** Header flags the spec fixes per type; everything not listed (but PUBLISH) uses 0. */
const FIXED_FLAGS: Partial<Record<PacketType, number>> = {
  pubrel: 0b0010,
  subscribe: 0b0010,
  unsubscribe: 0b0010,
}

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })

// ---------------------------------------------------------------------------
// Encoding

const concat = (parts: Uint8Array[]): Uint8Array => Buffer.concat(parts)

/** Payloads may be given as text; MQTT carries bytes. */
export function toBytes(payload: string | Uint8Array): Uint8Array {
  return typeof payload === 'string' ? encoder.encode(payload) : payload
}

export function toMessage({
  topic,
  payload,
  qos,
  retain,
}: PublishPacket): Message {
  return { topic, payload, qos, retain }
}

const u16 = (n: number) => Uint8Array.of((n >> 8) & 0xff, n & 0xff)

function binary(bytes: Uint8Array): Uint8Array {
  if (bytes.length > 0xffff)
    throw new MqttProtocolError('Field longer than 65535 bytes')
  return concat([u16(bytes.length), bytes])
}

const string = (s: string) => binary(encoder.encode(s))

function frame(
  type: PacketType,
  body: Uint8Array[],
  flags = FIXED_FLAGS[type] ?? 0,
): Uint8Array {
  let length = body.reduce((n, b) => n + b.length, 0)
  if (length > MAX_REMAINING_LENGTH)
    throw new MqttProtocolError('Packet too large')
  const header = [((PACKET_TYPES.indexOf(type) + 1) << 4) | flags]
  do {
    let byte = length % 128
    length = Math.floor(length / 128)
    if (length > 0) byte |= 0x80
    header.push(byte)
  } while (length > 0)
  return concat([Uint8Array.from(header), ...body])
}

function encodeConnect(packet: ConnectPacket): Uint8Array {
  const { will, username, password } = packet
  let flags = packet.cleanSession ? 0x02 : 0
  const payload = [string(packet.clientId)]
  if (will) {
    flags |= 0x04 | (will.qos << 3) | (will.retain ? 0x20 : 0)
    payload.push(string(will.topic), binary(will.payload))
  }
  if (username !== undefined) {
    flags |= 0x80
    payload.push(string(username))
  }
  if (password !== undefined) {
    flags |= 0x40
    payload.push(binary(password))
  }
  return frame('connect', [
    string(packet.protocolName),
    Uint8Array.of(packet.protocolLevel, flags),
    u16(packet.keepAlive),
    ...payload,
  ])
}

function encodePublish(packet: PublishPacket): Uint8Array {
  const { qos, packetId } = packet
  const flags =
    (packet.dup ? 0x08 : 0) | (qos << 1) | (packet.retain ? 0x01 : 0)
  const body = [string(packet.topic)]
  if (qos > 0) {
    if (packetId === undefined)
      throw new MqttProtocolError('QoS > 0 PUBLISH needs a packet id')
    body.push(u16(packetId))
  }
  body.push(packet.payload)
  return frame('publish', body, flags)
}

export function encodePacket(packet: Packet): Uint8Array {
  switch (packet.type) {
    case 'connect':
      return encodeConnect(packet)
    case 'publish':
      return encodePublish(packet)
    case 'connack':
      return frame('connack', [
        Uint8Array.of(Number(packet.sessionPresent), packet.returnCode),
      ])
    case 'subscribe':
      return frame('subscribe', [
        u16(packet.packetId),
        ...packet.subscriptions.flatMap((s) => [
          string(s.filter),
          Uint8Array.of(s.qos),
        ]),
      ])
    case 'suback':
      return frame('suback', [
        u16(packet.packetId),
        Uint8Array.from(packet.granted),
      ])
    case 'unsubscribe':
      return frame('unsubscribe', [
        u16(packet.packetId),
        ...packet.filters.map(string),
      ])
    case 'puback':
    case 'pubrec':
    case 'pubrel':
    case 'pubcomp':
    case 'unsuback':
      return frame(packet.type, [u16(packet.packetId)])
    case 'pingreq':
    case 'pingresp':
    case 'disconnect':
      return frame(packet.type, [])
    default:
      return unreachable(packet)
  }
}

function unreachable(packet: never): never {
  throw new Error(`Unhandled packet ${JSON.stringify(packet)}`)
}

// ---------------------------------------------------------------------------
// Decoding

class Reader {
  private offset = 0
  constructor(private readonly buf: Uint8Array) {}

  get remaining() {
    return this.buf.length - this.offset
  }

  u8(): number {
    if (this.remaining < 1) throw new MqttProtocolError('Packet truncated')
    return this.buf[this.offset++]
  }

  u16(): number {
    return (this.u8() << 8) | this.u8()
  }

  /**
   * Copies, so a kept result (a retained message, a will) doesn't pin the
   * whole receive buffer. Not `slice`: on a Buffer that returns a view.
   */
  bytes(n: number): Uint8Array {
    if (this.remaining < n) throw new MqttProtocolError('Packet truncated')
    return new Uint8Array(this.buf.subarray(this.offset, (this.offset += n)))
  }

  binary(): Uint8Array {
    return this.bytes(this.u16())
  }

  string(): string {
    const bytes = this.binary()
    try {
      return decoder.decode(bytes)
    } catch {
      throw new MqttProtocolError('Invalid UTF-8 string')
    }
  }

  rest(): Uint8Array {
    return this.bytes(this.remaining)
  }

  /** Reads `read` until the packet is exhausted; MQTT requires at least one. */
  list<T>(read: () => T, what: string): T[] {
    const items: T[] = []
    while (this.remaining) items.push(read())
    if (!items.length) throw new MqttProtocolError(`${what} is empty`)
    return items
  }
}

function parseQos(n: number): QoS {
  if (n === 0 || n === 1 || n === 2) return n
  throw new MqttProtocolError(`Invalid QoS ${n}`)
}

export function minQos(a: QoS, b: QoS): QoS {
  return a < b ? a : b
}

function decodeConnect(r: Reader): ConnectPacket {
  const protocolName = r.string()
  const protocolLevel = r.u8()
  const flags = r.u8()
  if (flags & 0x01) throw new MqttProtocolError('Reserved CONNECT flag set')
  const keepAlive = r.u16()
  // Payload fields are read in the order the spec lays them out.
  const clientId = r.string()
  const will =
    flags & 0x04
      ? {
          topic: r.string(),
          payload: r.binary(),
          qos: parseQos((flags >> 3) & 0x03),
          retain: (flags & 0x20) !== 0,
        }
      : undefined
  const username = flags & 0x80 ? r.string() : undefined
  const password = flags & 0x40 ? r.binary() : undefined
  return {
    type: 'connect',
    protocolName,
    protocolLevel,
    clientId,
    cleanSession: (flags & 0x02) !== 0,
    keepAlive,
    ...(will && { will }),
    ...(username !== undefined && { username }),
    ...(password !== undefined && { password }),
  }
}

function decodePublish(r: Reader, flags: number): PublishPacket {
  const level = parseQos((flags >> 1) & 0x03)
  const topic = r.string()
  const packetId = level > 0 ? r.u16() : undefined
  return {
    type: 'publish',
    topic,
    packetId,
    payload: r.rest(),
    qos: level,
    retain: (flags & 0x01) !== 0,
    dup: (flags & 0x08) !== 0,
  }
}

const DECODERS: Record<PacketType, (r: Reader, flags: number) => Packet> = {
  connect: decodeConnect,
  connack: (r) => ({
    type: 'connack',
    sessionPresent: (r.u8() & 0x01) !== 0,
    returnCode: r.u8(),
  }),
  publish: decodePublish,
  puback: (r) => ({ type: 'puback', packetId: r.u16() }),
  pubrec: (r) => ({ type: 'pubrec', packetId: r.u16() }),
  pubrel: (r) => ({ type: 'pubrel', packetId: r.u16() }),
  pubcomp: (r) => ({ type: 'pubcomp', packetId: r.u16() }),
  subscribe: (r) => ({
    type: 'subscribe',
    packetId: r.u16(),
    subscriptions: r.list(
      () => ({ filter: r.string(), qos: parseQos(r.u8()) }),
      'SUBSCRIBE',
    ),
  }),
  suback: (r) => ({
    type: 'suback',
    packetId: r.u16(),
    granted: [...r.rest()],
  }),
  unsubscribe: (r) => ({
    type: 'unsubscribe',
    packetId: r.u16(),
    filters: r.list(() => r.string(), 'UNSUBSCRIBE'),
  }),
  unsuback: (r) => ({ type: 'unsuback', packetId: r.u16() }),
  pingreq: () => ({ type: 'pingreq' }),
  pingresp: () => ({ type: 'pingresp' }),
  disconnect: () => ({ type: 'disconnect' }),
}

/** Decodes one packet from its first header byte and its body (the bytes after the remaining length). */
function decodePacket(firstByte: number, body: Uint8Array): Packet {
  const type: PacketType | undefined = PACKET_TYPES[(firstByte >> 4) - 1]
  if (!type)
    throw new MqttProtocolError(`Unknown packet type ${firstByte >> 4}`)
  const flags = firstByte & 0x0f
  if (type !== 'publish' && flags !== (FIXED_FLAGS[type] ?? 0)) {
    throw new MqttProtocolError(`Invalid flags ${flags} for ${type}`)
  }

  const r = new Reader(body)
  const packet = DECODERS[type](r, flags)
  if (r.remaining) throw new MqttProtocolError(`Trailing bytes in ${type}`)
  return packet
}

/** Splits a TCP byte stream into packets; feed it every chunk as it arrives. */
export class PacketParser {
  private buffer: Uint8Array = new Uint8Array(0)

  constructor(private readonly maxPacketSize = MAX_REMAINING_LENGTH) {}

  push(chunk: Uint8Array): Packet[] {
    this.buffer = this.buffer.length ? concat([this.buffer, chunk]) : chunk
    const packets: Packet[] = []
    let offset = 0

    for (;;) {
      const header = readFixedHeader(this.buffer, offset)
      if (!header) break
      const size = header.headerLength + header.remainingLength
      // Checked before the body arrives, so an oversized packet can't make us buffer it.
      if (size > this.maxPacketSize)
        throw new MqttProtocolError(`Packet of ${size} bytes exceeds limit`)
      if (offset + size > this.buffer.length) break
      const body = this.buffer.subarray(
        offset + header.headerLength,
        offset + size,
      )
      packets.push(decodePacket(this.buffer[offset], body))
      offset += size
    }

    this.buffer = this.buffer.slice(offset)
    return packets
  }
}

function readFixedHeader(buf: Uint8Array, offset: number) {
  let remainingLength = 0
  let multiplier = 1
  for (let i = offset + 1; i < offset + 5; i++) {
    if (i >= buf.length) return null
    const byte = buf[i]
    remainingLength += (byte & 0x7f) * multiplier
    if (!(byte & 0x80)) return { remainingLength, headerLength: i - offset + 1 }
    multiplier *= 128
  }
  throw new MqttProtocolError('Malformed remaining length')
}
