// @ts-check
import { defineConfig } from 'astro/config'
import tailwindcss from '@tailwindcss/vite'
import svelte from '@astrojs/svelte'
import bun from '@nurodev/astro-bun'
import { spawn } from 'child_process'

/** @type {import('vite').Plugin} */
let socketProc = null
const socketServer = {
  name: 'socket-server',
  configureServer() {
    if (socketProc) socketProc.kill()
    socketProc = spawn('bun', ['server/socket.mjs'], { stdio: 'inherit' })
    process.on('exit', () => socketProc?.kill())
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
