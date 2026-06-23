// @ts-check
import { defineConfig } from 'astro/config'
import tailwindcss from '@tailwindcss/vite'
import svelte from '@astrojs/svelte'
import bun from '@nurodev/astro-bun'
import { spawn } from 'child_process'

/** @type {import('vite').Plugin} */
const socketServer = {
  name: 'socket-server',
  configureServer() {
    const proc = spawn('bun', ['server/socket.mjs'], { stdio: 'inherit' })
    process.on('exit', () => proc.kill())
  },
}

// https://astro.build/config
export default defineConfig({
  adapter: bun(),
  output: 'server',
  integrations: [svelte()],
  vite: {
    plugins: [tailwindcss(), socketServer],
  },
})
