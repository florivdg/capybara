import { ActionError, defineAction } from 'astro:actions'
import { z } from 'astro/zod'
import { ANIMATIONS } from '@/lib/pixbar/animations'
import { ANIMATION_NAMES } from '@/lib/pixbar/animations/names'
import { ClockError } from '@/lib/pixbar/http'
import { display, type Display } from '@/lib/server/display'

/** Runs `run` on the display and answers with the new status. */
async function respond(run: (display: Display) => void | Promise<void>) {
  const current = display()
  try {
    await run(current)
  } catch (error) {
    // Only failures to reach the clock are expected; anything else is a bug.
    if (!(error instanceof ClockError)) throw error
    throw new ActionError({ code: 'BAD_GATEWAY', message: error.message })
  }
  return current.status()
}

const command = (run: (display: Display) => void | Promise<void>) =>
  defineAction({ handler: () => respond(run) })

export const server = {
  play: defineAction({
    input: z.object({ animation: z.enum(ANIMATION_NAMES) }),
    handler: ({ animation }) =>
      respond((d) => d.play(animation, ANIMATIONS[animation].create())),
  }),
  stop: command((d) => d.stop()),
  clear: command((d) => d.clear()),
  /** Lets the page resync after a failed command, which carries no status. */
  status: command(() => {}),
}
