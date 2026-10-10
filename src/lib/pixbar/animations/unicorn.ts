import { Canvas, WIDTH, dim, type CustomAppFrame } from '../display'

// Facing right. Letters are palette keys; 1-5 are the mane/tail rainbow
// slots, which cycle colours every frame.
const BODY = [
  '.............Y..',
  '............Y...',
  '..........1WWW..',
  '.........12WKWW.',
  '........123WWWWP',
  '.......1234W....',
  '.12...12345W....',
  '123.WWWWWWWW....',
  '23.WWWWWWWWW....',
  '3..WWWWWWWWW....',
]
const LEGS = [
  ['....WW....WW....', '....GG....GG....'],
  ['...W..W..W..W...', '..G....GG....G..'],
]
const PALETTE: Record<string, number> = {
  W: 0xffffff,
  G: 0x808080,
  Y: 0xffd700,
  K: 0x200020,
  P: 0xff80c0,
}
const RAINBOW = [0xff0000, 0xff8000, 0xffff00, 0x00ff00, 0x0080ff, 0x8000ff]
export const SPRITE_WIDTH = BODY[0].length
const SPARKLE_LIFE = 6

interface Sparkle {
  x: number
  y: number
  color: number
  life: number
}

const mirror = (rows: string[]) =>
  rows.map((row) => row.split('').toReversed().join(''))
/** Built once: `SPRITES[facingRight ? 0 : 1][legFrame]`. */
const SPRITES = [
  LEGS.map((legs) => [...BODY, ...legs]),
  LEGS.map((legs) => mirror([...BODY, ...legs])),
]

const sprite = (t: number, facingRight: boolean): string[] =>
  SPRITES[facingRight ? 0 : 1][t % 2]

function render(
  t: number,
  x: number,
  facingRight: boolean,
  sparkles: Sparkle[],
): Canvas {
  const canvas = new Canvas()
  for (const s of sparkles)
    canvas.set(s.x, s.y, dim(s.color, s.life / SPARKLE_LIFE))

  const y0 = t % 2 ? 3 : 2 // bob while galloping
  sprite(t, facingRight).forEach((row, dy) => {
    row.split('').forEach((ch, dx) => {
      if (ch === '.') return
      const color = /\d/.test(ch)
        ? RAINBOW[(Number(ch) + t) % RAINBOW.length]
        : PALETTE[ch]
      canvas.set(x + dx, y0 + dy, color)
    })
  })
  return canvas
}

/**
 * A unicorn galloping back and forth across the PixBar, trailing sparkles.
 * Each `next()` advances one tick and returns a full-screen bitmap frame.
 */
export function createUnicorn({
  random = Math.random,
}: { random?: () => number } = {}) {
  let x = -SPRITE_WIDTH
  let direction = 1
  let t = 0
  let sparkles: Sparkle[] = []
  const pick = <T>(items: T[]) => items[Math.floor(random() * items.length)]

  return {
    next(): CustomAppFrame {
      // Sparkles fall off the tail and fade out.
      const tailX = direction > 0 ? x : x + SPRITE_WIDTH - 1
      sparkles.push({
        x: tailX,
        y: pick([8, 9, 10, 11, 12, 13]),
        color: pick(RAINBOW),
        life: SPARKLE_LIFE,
      })
      for (const s of sparkles) s.life--
      sparkles = sparkles.filter((s) => s.life > 0)

      const frame: CustomAppFrame = {
        duration: 5,
        draw: [render(t, x, direction > 0, sparkles).toBitmap()],
      }

      x += direction
      // Turn around once fully off-screen, so it re-enters facing the other way.
      if (x > WIDTH || x < -SPRITE_WIDTH) direction = -direction
      t++
      return frame
    },
  }
}
