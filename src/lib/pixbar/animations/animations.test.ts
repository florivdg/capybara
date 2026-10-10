import { expect, test } from 'bun:test'
import { FRAME_DURATION, HEIGHT, WIDTH } from '../display'
import { ANIMATIONS } from '.'
import { DINO_COLOR, createDinosaur } from './dinosaur'
import { bitmap } from './testing'

/** A seeded generator, so a failure replays the same way. */
function seeded(seed: number) {
  return () => {
    seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31
    return seed / 2 ** 31
  }
}

test.each(Object.entries(ANIMATIONS))(
  '%s emits full-screen bitmap frames',
  (_name, create) => {
    const animation = create()
    for (let i = 0; i < 300; i++) {
      const frame = animation.next()
      expect(frame.duration).toBe(FRAME_DURATION)
      const [x, y, w, h, pixels] = bitmap(frame)
      expect([x, y, w, h]).toEqual([0, 0, WIDTH, HEIGHT])
      expect(pixels).toHaveLength(WIDTH * HEIGHT)
    }
  },
)

test('the dinosaur clears every cactus', () => {
  const dinosaur = createDinosaur({ random: seeded(42) })
  const shown = () =>
    bitmap(dinosaur.next())[4].filter((c) => c === DINO_COLOR).length
  // The first cactus starts off-screen, so frame 0 shows the whole dinosaur.
  // Cacti are drawn over it, so any overlap later hides some of its pixels.
  const whole = shown()
  for (let i = 1; i < 2000; i++) {
    expect({ frame: i, pixels: shown() }).toEqual({ frame: i, pixels: whole })
  }
})
