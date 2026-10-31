import { Canvas, WIDTH, type CustomAppFrame } from '../display'
import { drawSprite, mirror, palette } from './sprite'

// Clawd, Claude Code's mascot, facing us. Eyes are `k` over `K`: a blink
// paints `k` in body color, leaving a closed-eye line, and a happy squint
// paints `K`. P is a blushing cheek.
const BODY = [
  'OOOOOOOOOOOOOOOOOO',
  'OOOkkOOOOOOOOkkOOO',
  'OOOKKOOOOOOOOKKOOO',
  'OPPOOOOOOOOOOOOPPO',
  'OOOOOOOOOOOOOOOOOO',
  'OOOOOOOOOOOOOOOOOO',
]
const ARM = ['OO', 'OO']
/** The left arm raised; the right one is its mirror image. */
const ARM_UP = ['O.', 'OO', '.O']
/** Standing, then two scuttle steps that each lift a pair of legs. */
const LEGS = [
  ['...OO.OO......OO.OO...', '...OO.OO......OO.OO...'],
  ['...OO.OO......OO.OO...', '...OO.........OO......'],
  ['...OO.OO......OO.OO...', '......OO.........OO...'],
]
const HEART = ['RR.RR', 'RRRRR', '.RRR.', '..R..']
const ARM_UP_RIGHT = mirror(ARM_UP)
/** Arms stick out this far on each side of the body. */
const ARM_WIDTH = ARM[0].length
const SPRITE_WIDTH = BODY[0].length + 2 * ARM_WIDTH

const BODY_COLOR = 0xd77757
const COLORS = {
  O: BODY_COLOR,
  k: 0x000000,
  K: 0x000000,
  P: 0xff6b8a,
  R: 0xff4d6d,
}
const OPEN = palette(COLORS)
const BLINK = palette({ ...COLORS, k: BODY_COLOR })
const HAPPY = palette({ ...COLORS, K: BODY_COLOR })

const SAND = 0x4a3520
const STARS: readonly [x: number, y: number][] = [
  [2, 2],
  [9, 5],
  [17, 1],
  [26, 3],
  [34, 1],
  [41, 5],
  [48, 2],
]

/** Feet on row 14, just above the sand. */
const Y = 7
/** Where it stops to cheer, centered. */
const REST_X = Math.floor((WIDTH - SPRITE_WIDTH) / 2)
/** Frames to scuttle in from off-screen left to the middle, at a pixel a frame. */
const WALK_IN = REST_X + SPRITE_WIDTH
const REST = 40
/** One trip: in from the left, a rest in the middle, out on the right. */
const CYCLE = WALK_IN + REST + WIDTH - REST_X
/** While resting it hops three times, waving its arms, from here... */
const CHEER_START = 8
/** ...to here. */
const CHEER_END = 32
/** Height above the sand through one hop. */
const HOP = [1, 2, 2, 1, 0, 0, 0, 0]
/** Rest frames when a heart pops out, and the column it rises from. */
const HEARTS: readonly [frame: number, dx: number][] = [
  [10, 3],
  [18, 14],
  [26, 9],
]
const HEART_Y = 2

interface Pose {
  x: number
  lift: number
  armsUp: boolean
  /** Index into LEGS. */
  step: number
}

/** Where Clawd is and what it's doing at frame `c` of a trip. */
function pose(c: number): Pose {
  const rest = c - WALK_IN
  if (rest < 0 || rest >= REST) {
    const x = rest < 0 ? c - SPRITE_WIDTH : REST_X + rest - REST
    return { x, lift: 0, armsUp: false, step: 1 + ((c >> 1) % 2) }
  }
  const cheering = rest >= CHEER_START && rest < CHEER_END
  const hop = (rest - CHEER_START) % HOP.length
  return {
    x: REST_X,
    lift: cheering ? HOP[hop] : 0,
    armsUp: cheering && HOP[hop] > 0,
    step: 0,
  }
}

function drawClawd(
  canvas: Canvas,
  { x, lift, armsUp, step }: Pose,
  blink: boolean,
): void {
  const y = Y - lift
  const colors = armsUp ? HAPPY : blink ? BLINK : OPEN
  const [left, right, armY] = armsUp
    ? [ARM_UP, ARM_UP_RIGHT, y]
    : [ARM, ARM, y + 3]
  drawSprite(canvas, left, x, armY, colors)
  drawSprite(canvas, right, x + SPRITE_WIDTH - ARM_WIDTH, armY, colors)
  drawSprite(canvas, BODY, x + ARM_WIDTH, y, colors)
  drawSprite(canvas, LEGS[step], x, y + BODY.length, colors)
}

/** Hearts float up from where Clawd rests, swaying, until they leave the top. */
function drawHearts(canvas: Canvas, rest: number): void {
  for (const [frame, dx] of HEARTS) {
    const age = rest - frame
    const y = HEART_Y - (age >> 1)
    if (age < 0 || y <= -HEART.length) continue
    const sway = (age >> 2) % 2
    drawSprite(canvas, HEART, REST_X + dx + sway, y, OPEN)
  }
}

function drawBackdrop(canvas: Canvas, t: number): void {
  STARS.forEach(([x, y], i) => {
    const twinkle = (t + i * 5) % 16
    canvas.set(x, y, twinkle < 2 ? 0x9a9ab8 : 0x2a2a3a)
  })
  for (let x = 0; x < WIDTH; x++) canvas.set(x, 15, SAND)
}

/**
 * Clawd, Claude Code's mascot, scuttling crab-style across the PixBar. In the
 * middle it hops and waves its arms while hearts float up, then scuttles on.
 * Each `next()` advances one tick and returns a full-screen bitmap frame.
 */
export function createClawd() {
  let t = 0
  return {
    next(): CustomAppFrame {
      const c = t % CYCLE
      const canvas = new Canvas()
      drawBackdrop(canvas, t)
      drawHearts(canvas, c - WALK_IN)
      drawClawd(canvas, pose(c), t % 36 < 2)
      t++
      return canvas.toFrame()
    },
  }
}
