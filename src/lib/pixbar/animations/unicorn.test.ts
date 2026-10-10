import { expect, test } from 'bun:test'
import { WIDTH, frameBitmap } from '../display'
import { SPRITE_WIDTH, createUnicorn } from './unicorn'

test('gallops across, turns around, and comes back', () => {
  const unicorn = createUnicorn({ random: () => 0 })
  const lit = (n: number) => {
    const pixels = frameBitmap(unicorn.next())[4]
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
