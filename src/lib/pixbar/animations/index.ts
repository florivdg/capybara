import type { Animation } from '../stream'
import { createCapybara } from './capybara'
import { createDinosaur } from './dinosaur'
import type { AnimationName } from './names'
import { createUnicorn } from './unicorn'

interface AnimationEntry {
  create: () => Animation
  /** A frame where the animation's star is in full view, for previews. */
  poster: number
}

/** Every animation the UI can play, by name. */
export const ANIMATIONS: Record<AnimationName, AnimationEntry> = {
  unicorn: { create: createUnicorn, poster: 34 }, // mid-gallop
  dinosaur: { create: createDinosaur, poster: 22 }, // mid-jump over a cactus
  capybara: { create: createCapybara, poster: 60 }, // walking with the orange
}
