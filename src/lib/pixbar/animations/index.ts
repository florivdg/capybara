import type { Animation } from '../stream'
import { createCapybara } from './capybara'
import { createDinosaur } from './dinosaur'
import type { AnimationName } from './names'
import { createUnicorn } from './unicorn'

/** Every animation the UI can play, by name. */
export const ANIMATIONS: Record<AnimationName, () => Animation> = {
  unicorn: createUnicorn,
  dinosaur: createDinosaur,
  capybara: createCapybara,
}
