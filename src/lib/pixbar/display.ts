/**
 * Ulanzi TC002 PixBar (stock firmware): a 52×16 RGB matrix, origin top-left.
 *
 * Frames for a "custom app" are JSON, sent either over HTTP
 * (`POST http://<ip>/api/custom?name=<app>`) or over MQTT
 * (publish to `<prefix>/custom/<app>`). The built-in font is ASCII-only and
 * misses some lowercase glyphs, so upper-case text.
 */

/** The clock's MQTT topic prefix: `<mqtt_prefix>_<last 4 of MAC>`. */
export const DEFAULT_PREFIX = 'ulanzi_a834'

export const WIDTH = 52
export const HEIGHT = 16

/** `#RRGGBB` string or 0xRRGGBB number. */
export type Color = string | number
export type Rect = [x: number, y: number, width: number, height: number]

export type DrawCommand =
  /** Rectangle outline. */
  | { dr: [...Rect, Color] }
  /** Filled rectangle. */
  | { df: [...Rect, Color] }
  /** Bitmap: width × height 0xRRGGBB pixels, row-major. */
  | { db: [...Rect, number[]] }

export interface TextElement {
  content: string
  fontHeight?: number
  x?: number
  y?: number
  align?: string
  rect?: Rect
  color?: Color
}

export interface CustomAppFrame {
  /** Seconds the app stays on screen. */
  duration?: number
  draw?: DrawCommand[]
  text?: TextElement[]
}

/**
 * The clock subscribes to `<mqtt_prefix>_<last 4 of MAC>/custom/+`, so
 * `prefix` is e.g. `ulanzi_a834`. The first frame creates the app; removing
 * it takes the HTTP API (see `removeCustomApp`).
 */
export function customAppTopic(prefix: string, app: string): string {
  return `${prefix}/custom/${app}`
}

/**
 * Publishing a custom app's name here brings it to the foreground. Without
 * that, the clock keeps showing whatever app it is on, however many frames
 * arrive for ours.
 */
export function switchAppTopic(prefix: string): string {
  return `${prefix}/switchDiyApp`
}

/** A frame buffer you draw into, then send as one `db` bitmap. */
export class Canvas {
  readonly pixels: number[] = Array.from({ length: WIDTH * HEIGHT }, () => 0)

  /** Out-of-bounds pixels are ignored, so sprites can slide off the edges. */
  set(x: number, y: number, color: number): void {
    if (x >= 0 && x < WIDTH && y >= 0 && y < HEIGHT)
      this.pixels[y * WIDTH + x] = color
  }

  toBitmap(): DrawCommand {
    return { db: [0, 0, WIDTH, HEIGHT, this.pixels] }
  }
}

/** Scales each RGB channel of a 0xRRGGBB color by `factor` (0–1). */
export function dim(color: number, factor: number): number {
  const channel = (shift: number) =>
    Math.floor(((color >> shift) & 0xff) * factor) << shift
  return channel(16) | channel(8) | channel(0)
}
