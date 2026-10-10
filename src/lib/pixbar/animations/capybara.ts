import { Canvas, WIDTH, type CustomAppFrame } from '../display'
import { drawSprite, palette, withLegs } from './sprite'

// Facing right, with the obligatory orange on its head (L is the leaf).
// K is the eye; the blink paints it over with body color.
const BODY = [
  '............L.....',
  '...........OOO....',
  '....BBBBB.dOOOd...',
  '...BBBBBBBBBBBBBB.',
  '..BBBBBBBBBBBBBKBB',
  '..BBBBBBBBBBBBBBBB',
  '..BBBBBBBBBBBBBBBd',
  '..BBBBBBBBBBB.....',
  '...BBBBBBBBB......',
]
const LEGS = [
  ['..dd.dd..dd.dd....', '..dd.dd..dd.dd....'],
  ['...dd.dd..dd.dd...', '...dd.dd..dd.dd...'],
]
const SPRITES = withLegs(BODY, LEGS)
const SPRITE_WIDTH = BODY[0].length

const BODY_COLOR = 0x9a6a3a
const COLORS = {
  B: BODY_COLOR,
  d: 0x4a2e14,
  K: 0x140a04,
  O: 0xff8c00,
  L: 0x3cb043,
}
const OPEN = palette(COLORS)
const CLOSED = palette({ ...COLORS, K: BODY_COLOR })

const GRASS = 0x1f5f28
const TUFT = 0x3f9a46
const TUFTS = [2, 9, 16, 24, 33, 40, 47]

/** Feet on row 14, just above the grass. */
const Y = 4
/** Where it stops for a while, roughly centered. */
const REST_X = Math.floor((WIDTH - SPRITE_WIDTH) / 2)
const REST_FRAMES = 32

function drawScene(t: number, x: number, resting: boolean): Canvas {
  const canvas = new Canvas()
  for (let gx = 0; gx < WIDTH; gx++) canvas.set(gx, 15, GRASS)
  for (const tx of TUFTS) canvas.set(tx, 14, TUFT)

  const eyesClosed = resting || t % 40 < 2 // chilling, or a blink
  const step = resting ? 0 : (t >> 1) % 2
  drawSprite(canvas, SPRITES[step], x, Y, eyesClosed ? CLOSED : OPEN)
  return canvas
}

/**
 * A capybara ambling across the PixBar with an orange on its head. It stops
 * in the middle to chill with its eyes closed, then wanders on. Each `next()`
 * advances one tick and returns a full-screen bitmap frame.
 */
export function createCapybara() {
  let t = 0
  let x = -SPRITE_WIDTH
  let rest = 0 // frames left to chill

  /** Capybaras are not in a hurry: one pixel every other frame. */
  function walk() {
    x = x >= WIDTH ? -SPRITE_WIDTH : x + 1
    if (x === REST_X) rest = REST_FRAMES
  }

  return {
    next(): CustomAppFrame {
      const canvas = drawScene(t, x, rest > 0)
      t++
      if (rest > 0) rest--
      else if (t % 2 === 0) walk()
      return canvas.toFrame()
    },
  }
}
