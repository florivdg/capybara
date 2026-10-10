import { ActionError, defineAction } from 'astro:actions'
import { createUnicorn } from '@/lib/pixbar/animations/unicorn'
import { ClockError } from '@/lib/pixbar/http'
import { display, type Display } from '@/lib/server/display'

/** An action that runs `run` on the display and answers with the new status. */
const command = (run: (display: Display) => void | Promise<void>) =>
  defineAction({
    handler: async () => {
      const current = display()
      try {
        await run(current)
      } catch (error) {
        // Only failures to reach the clock are expected; anything else is a bug.
        if (!(error instanceof ClockError)) throw error
        throw new ActionError({ code: 'BAD_GATEWAY', message: error.message })
      }
      return current.status()
    },
  })

export const server = {
  startUnicorn: command((d) => d.play('unicorn', createUnicorn())),
  stop: command((d) => d.stop()),
  clear: command((d) => d.clear()),
  /** Lets the page resync after a failed command, which carries no status. */
  status: command(() => {}),
}
