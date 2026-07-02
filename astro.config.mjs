// @ts-check
import { defineConfig } from 'astro/config'
import tailwindcss from '@tailwindcss/vite'
import svelte from '@astrojs/svelte'
import node from '@astrojs/node'
import { spawn } from 'child_process'

/** @type {import('child_process').ChildProcess | null} */
let socketProc = null
/** @type {import('vite').Plugin} */
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
  adapter: node({ mode: 'standalone' }),
  output: 'server',
  integrations: [svelte()],
  vite: {
    plugins: [tailwindcss(), socketServer],
  },
})
