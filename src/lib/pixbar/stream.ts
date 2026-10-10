import { customAppTopic, switchAppTopic, type CustomAppFrame } from './display'

/** Anything that produces frames, one per tick (e.g. `createUnicorn()`). */
export interface Animation {
  next(): CustomAppFrame
}

export type Publish = (topic: string, payload: string) => void

export interface StreamOptions {
  prefix: string
  app: string
  fps: number
}

export interface Stream {
  stop(): void
  /**
   * Sends a frame and then brings the app to the foreground. Runs once at
   * the start; call it again when the clock (re)connects, since publishes
   * aren't retained and a clock that wasn't listening missed the switch.
   */
  activate(): void
}

/** Streams an animation into a custom app and brings that app to the foreground. */
export function streamApp(
  publish: Publish,
  animation: Animation,
  { prefix, app, fps }: StreamOptions,
): Stream {
  const topic = customAppTopic(prefix, app)
  const send = () => publish(topic, JSON.stringify(animation.next()))
  const activate = () => {
    // The frame creates the app if needed, so the switch can find it.
    send()
    publish(switchAppTopic(prefix), app)
  }
  activate()
  const timer = setInterval(send, 1000 / fps)
  return { stop: () => clearInterval(timer), activate }
}
