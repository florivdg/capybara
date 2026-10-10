import { ANIMATIONS } from './animations'
import type { AnimationName } from './animations/names'
import { frameBitmap } from './display'

/** The pixels of an animation's poster frame, for previews in the UI. */
export function posterPixels(name: AnimationName): number[] {
  const { create, poster } = ANIMATIONS[name]
  const animation = create()
  for (let i = 0; i < poster; i++) animation.next()
  return frameBitmap(animation.next())[4]
}
