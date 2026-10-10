/**
 * Animation names, kept apart from the animations themselves so the browser
 * can use them without bundling any rendering code.
 */
export const ANIMATION_NAMES = ['unicorn', 'dinosaur', 'capybara'] as const

export type AnimationName = (typeof ANIMATION_NAMES)[number]

export function isAnimationName(name: unknown): name is AnimationName {
  return ANIMATION_NAMES.some((known) => known === name)
}
