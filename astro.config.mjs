// @ts-check
import { defineConfig, fontProviders } from 'astro/config'

import node from '@astrojs/node'

import { pixbar } from './src/integrations/pixbar.ts'

// https://astro.build/config
export default defineConfig({
  output: 'server',
  // Runs on Bun, not Node: the MQTT broker uses Bun's TCP sockets.
  adapter: node({ mode: 'standalone' }),
  integrations: [pixbar()],

  // Downloaded at build time and served from the app itself
  fonts: [
    {
      provider: fontProviders.google(),
      name: 'Pixelify Sans',
      cssVariable: '--font-pixel',
      // A variable font: one file covers the whole range
      weights: ['400 700'],
      styles: ['normal'],
    },
  ],
})
