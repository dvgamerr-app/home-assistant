// @ts-check
import { defineConfig } from 'astro/config'
import tailwindcss from '@tailwindcss/vite'
import svelte from '@astrojs/svelte'
import bun from '@nurodev/astro-bun'

// https://astro.build/config
export default defineConfig({
  adapter: bun(),
  output: 'server',
  integrations: [svelte()],
  vite: {
    plugins: [tailwindcss()],
  },
})
