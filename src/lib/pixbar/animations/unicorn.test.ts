import { expect, test } from 'bun:test'
import { HEIGHT, WIDTH, type CustomAppFrame } from '../display'
import { SPRITE_WIDTH, createUnicorn } from './unicorn'

function bitmap(frame: CustomAppFrame) {
  const cmd = frame.draw?.[0]
  if (!cmd || !('db' in cmd)) throw new Error('expected a db bitmap')
  return cmd.db
}

test('emits full-screen bitmap frames', () => {
  const frame = createUnicorn().next()
  expect(frame.duration).toBe(5)
  const [x, y, w, h, pixels] = bitmap(frame)
  expect([x, y, w, h]).toEqual([0, 0, WIDTH, HEIGHT])
  expect(pixels).toHaveLength(WIDTH * HEIGHT)
})

test('gallops across, turns around, and comes back', () => {
  const unicorn = createUnicorn({ random: () => 0 })
  const lit = (n: number) => {
    const pixels = bitmap(unicorn.next())[4]
    return pixels.some((color, i) => i % WIDTH === n && color !== 0)
  }
  // Starts fully off-screen left, reaches the right edge after one crossing.
  const crossing = WIDTH + SPRITE_WIDTH
  const rightEdgeSeen = Array.from({ length: crossing + 1 }, () =>
    lit(WIDTH - 1),
  ).some(Boolean)
  expect(rightEdgeSeen).toBe(true)
  const leftEdgeSeenOnReturn = Array.from({ length: crossing + 2 }, () =>
    lit(0),
  ).some(Boolean)
  expect(leftEdgeSeenOnReturn).toBe(true)
})
