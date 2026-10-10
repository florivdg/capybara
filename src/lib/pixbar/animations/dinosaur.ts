import { Canvas, WIDTH, type CustomAppFrame } from '../display'
import { drawSprite, palette, withLegs } from './sprite'

// Facing right, after the browser's offline dinosaur. The eye is a gap.
const BODY = [
  '.......GGGGG',
  '.......G.GGG',
  '.......GGGGG',
  '.......GGG..',
  'G.....GGGGG.',
  'G....GGGG...',
  'GG..GGGGGGG.',
  '.GGGGGGGG...',
  '..GGGGGG....',
]
const LEGS = [
  ['...GG..G....', '....G..GG...'],
  ['...G..GG....', '...GG..G....'],
]
const SPRITES = withLegs(BODY, LEGS)
const CACTUS = ['.C..', 'CC.C', '.CCC', '.C..']
const CLOUD = ['.WW.', 'WWWW']
const CLOUD_WIDTH = CLOUD[0].length

export const DINO_COLOR = 0x5ad25a
const COLORS = palette({ G: DINO_COLOR, C: 0x2e8b57, W: 0x404040 })
const GROUND_COLOR = 0x6b4a2b

/** The dinosaur runs in place; the world scrolls by this many pixels a frame. */
const SPEED = 2
const DINO_X = 3
/** Standing, the feet are on row 14, just above the ground. */
const DINO_Y = 4
const CACTUS_Y = 11
/** Height above the ground for each frame of a jump. */
const JUMP = [2, 3, 4, 4, 4, 4, 4, 4, 3, 2]
/** How far ahead of the dinosaur's nose a cactus is when the jump starts. */
const JUMP_DISTANCE = 2

/**
 * The browser's offline dinosaur, running and jumping over cacti. Each
 * `next()` advances one tick and returns a full-screen bitmap frame.
 */
export function createDinosaur({
  random = Math.random,
}: { random?: () => number } = {}) {
  let t = 0
  let cactusX = WIDTH
  let jumpFrame = JUMP.length // index into JUMP; past its end is on the ground
  const nose = DINO_X + BODY[0].length

  return {
    next(): CustomAppFrame {
      const grounded = jumpFrame >= JUMP.length
      if (grounded && cactusX - nose <= JUMP_DISTANCE) jumpFrame = 0
      const lift = jumpFrame < JUMP.length ? JUMP[jumpFrame] : 0

      const canvas = new Canvas()
      for (let x = 0; x < WIDTH; x++) {
        if ((x + t * SPEED) % 8 < 6) canvas.set(x, 15, GROUND_COLOR)
      }
      // Drifts left a pixel every 4 frames, re-entering on the right.
      const cloudX = WIDTH - ((t >> 2) % (WIDTH + CLOUD_WIDTH))
      drawSprite(canvas, CLOUD, cloudX, 1, COLORS)
      drawSprite(canvas, SPRITES[t % 2], DINO_X, DINO_Y - lift, COLORS)
      drawSprite(canvas, CACTUS, cactusX, CACTUS_Y, COLORS)

      t++
      jumpFrame++
      cactusX -= SPEED
      // Once a cactus has scrolled off, the next one comes after a random gap.
      if (cactusX < -CACTUS[0].length) {
        cactusX = WIDTH + Math.floor(random() * 24)
      }
      return canvas.toFrame()
    },
  }
}
