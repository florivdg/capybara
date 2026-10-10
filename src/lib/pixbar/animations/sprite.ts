import type { Canvas } from '../display'

/** Maps a sprite character to a 0xRRGGBB color, or `undefined` for transparent. */
export type SpriteColor = (ch: string) => number | undefined

/**
 * Draws a sprite given as rows of characters, top-left at (x, y). Characters
 * without a color (e.g. `.`) are transparent.
 */
export function drawSprite(
  canvas: Canvas,
  rows: readonly string[],
  x: number,
  y: number,
  color: SpriteColor,
): void {
  rows.forEach((row, dy) => {
    for (let dx = 0; dx < row.length; dx++) {
      const c = color(row[dx])
      if (c !== undefined) canvas.set(x + dx, y + dy, c)
    }
  })
}

/** Color lookup for sprites whose characters map to fixed colors. */
export const palette =
  (colors: Partial<Record<string, number>>): SpriteColor =>
  (ch) =>
    colors[ch]

/** One complete sprite per leg pose: the shared body with each set of legs below it. */
export const withLegs = (
  body: readonly string[],
  legPoses: readonly (readonly string[])[],
): string[][] => legPoses.map((legs) => [...body, ...legs])

/** Mirrors a sprite horizontally, e.g. to face the other way. */
export const mirror = (rows: readonly string[]): string[] =>
  rows.map((row) => row.split('').toReversed().join(''))
