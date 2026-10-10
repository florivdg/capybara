// @ts-check
import { defineConfig } from 'astro/config'

import node from '@astrojs/node'

import { pixbar } from './src/integrations/pixbar.ts'

// https://astro.build/config
export default defineConfig({
  output: 'server',
  // Runs on Bun, not Node: the MQTT broker uses Bun's TCP sockets.
  adapter: node({ mode: 'standalone' }),
  integrations: [pixbar()],
})
