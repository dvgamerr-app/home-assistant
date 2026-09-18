// @ts-check
import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

/**
 * Integration ที่ประกอบ `dist/client/sw.js` จากเทมเพลต `src/pwa/service-worker.js`
 *
 * ต้องทำตอน build เพราะรายชื่อไฟล์ใน `_astro/` มี hash อยู่ในชื่อ — service worker
 * เขียนมือจะ precache ไม่ได้ และเวอร์ชันของ cache ต้องขยับตามไฟล์ที่ build ออกมาจริง
 * ไม่งั้น deploy ใหม่แล้วเครื่องผู้ใช้ยังกิน HTML เก่าที่ชี้ไป chunk ที่ถูกลบไปแล้ว
 */

/** ไฟล์ใน public/ ที่ต้องมีติดเครื่องไว้เสมอ (หน้า /offline เป็น route ไม่ใช่ไฟล์) */
const STATIC_PRECACHE = ['/offline', '/manifest.webmanifest', '/icon.svg', '/favicon.png', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-maskable-512.png', '/icons/apple-touch-icon.png']

/** @param {URL} dir */
async function listAstroAssets(dir) {
  try {
    const entries = await readdir(new URL('_astro/', dir), { withFileTypes: true })
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => `/_astro/${entry.name}`)
      .sort()
  } catch {
    return []
  }
}

/** @returns {import('astro').AstroIntegration} */
export function pwa() {
  /** @type {import('astro').AstroConfig | undefined} */
  let astroConfig

  return {
    name: 'ourkk-pwa',
    hooks: {
      'astro:config:done': ({ config }) => {
        astroConfig = config
      },

      'astro:build:done': async ({ logger }) => {
        if (!astroConfig) return
        const clientDir = astroConfig.build.client
        const templatePath = new URL('service-worker.js', import.meta.url)
        const template = await readFile(templatePath, 'utf8')

        const precache = [...STATIC_PRECACHE, ...(await listAstroAssets(clientDir))]
        // เวอร์ชันผูกกับทั้งเทมเพลตและรายชื่อไฟล์ → แก้อย่างใดอย่างหนึ่งก็ได้ cache ชุดใหม่
        const version = createHash('sha256').update(template).update(precache.join('\n')).digest('hex').slice(0, 12)

        // เทียบรูปแบบเป๊ะ ๆ ก่อนแทน — ชื่อ placeholder ถูกพูดถึงในคอมเมนต์หัวไฟล์ด้วย
        // เช็คแค่ว่า "ยังมีคำนี้อยู่ไหม" จะจับพลาดว่าแทนค่าไม่สำเร็จทั้งที่แทนไปแล้ว
        const VERSION_SLOT = "const VERSION = '__SW_VERSION__'"
        const PRECACHE_SLOT = 'const PRECACHE_URLS = __SW_PRECACHE__'
        if (!template.includes(VERSION_SLOT) || !template.includes(PRECACHE_SLOT)) {
          throw new Error('pwa: หา placeholder ใน service-worker.js ไม่เจอ — เทมเพลตถูกแก้รูปแบบไปแล้ว')
        }

        const output = template.replace(VERSION_SLOT, `const VERSION = ${JSON.stringify(version)}`).replace(PRECACHE_SLOT, `const PRECACHE_URLS = ${JSON.stringify(precache)}`)

        const target = new URL('sw.js', clientDir)
        await writeFile(target, output, 'utf8')
        logger.info(`sw.js — เวอร์ชัน ${version} · precache ${precache.length} ไฟล์ → ${fileURLToPath(target)}`)
      },
    },
  }
}
