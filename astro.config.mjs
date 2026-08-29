// @ts-check
import { defineConfig } from 'astro/config'
import tailwindcss from '@tailwindcss/vite'
import svelte from '@astrojs/svelte'
import node from '@astrojs/node'
import { spawn } from 'child_process'

/** @type {import('child_process').ChildProcess | null} */
let socketProc = null

const stopSocket = () => {
  socketProc?.kill()
  socketProc = null
}

process.once('exit', stopSocket)

/**
 * รัน server/socket.mjs คู่กับ `astro dev` เท่านั้น
 *
 * ใช้ hook `astro:server:*` แทน vite `configureServer` เพราะ `astro check`
 * ก็สร้าง vite server ด้วย ทำให้ตอน typecheck ไป spawn socket server จริง
 * แล้วยิง LINE notice / query DB ออกไปโดยไม่ตั้งใจ
 *
 * @returns {import('astro').AstroIntegration}
 */
const socketServer = () => ({
  name: 'socket-server',
  hooks: {
    'astro:server:start': () => {
      stopSocket()
      socketProc = spawn('bun', ['server/socket.mjs'], { stdio: 'inherit' })
    },
    'astro:server:done': stopSocket,
  },
})

// https://astro.build/config
export default defineConfig({
  adapter: node({ mode: 'standalone' }),
  output: 'server',
  integrations: [svelte(), socketServer()],
  vite: {
    plugins: [tailwindcss()],
  },
})
