import type { Socket } from 'bun'

/** A peer this far behind is too slow to keep up; drop it rather than grow memory. */
const MAX_QUEUED_BYTES = 16 * 1024 * 1024

/**
 * Bun sockets don't buffer: `write` may accept only part of the data. This
 * queues the remainder and sends it from the socket's `drain` handler.
 */
export class SocketWriter {
  private queue: Uint8Array[] = []
  private queuedBytes = 0

  constructor(private readonly socket: Socket<any>) {}

  write(data: Uint8Array): void {
    if (this.queue.length) return this.enqueue(data)
    const written = this.socket.write(data)
    if (written >= 0 && written < data.length)
      this.enqueue(data.subarray(written))
  }

  /** Call from the socket's `drain` handler. */
  flush(): void {
    while (this.queue.length) {
      const head = this.queue[0]
      const written = this.socket.write(head)
      if (written < 0) {
        this.queue = []
        this.queuedBytes = 0
        return
      }
      this.queuedBytes -= written
      if (written < head.length) {
        this.queue[0] = head.subarray(written)
        return
      }
      this.queue.shift()
    }
  }

  private enqueue(data: Uint8Array) {
    this.queue.push(data)
    this.queuedBytes += data.length
    if (this.queuedBytes > MAX_QUEUED_BYTES) this.socket.terminate()
  }
}
