import type { AstroIntegration } from 'astro'
import { display, shutdownDisplay } from '../lib/server/display'

/**
 * Starts the MQTT broker together with `astro dev`, so the clock can connect
 * before the first page request. Production does the same in
 * scripts/server.ts, since these hooks only run for the dev server.
 */
export function pixbar(): AstroIntegration {
  return {
    name: 'capybara:pixbar',
    hooks: {
      'astro:server:setup': ({ logger }) => {
        const current = display((message) => logger.info(message))
        logger.info(
          `MQTT broker listening, publishing to ${current.status().topic}`,
        )
      },
      'astro:server:done': () => shutdownDisplay(),
    },
  }
}
