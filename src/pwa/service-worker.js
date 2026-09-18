/// <reference lib="webworker" />

/**
 * Service worker ของแดชบอร์ดบ้าน — เป้าหมายคือ "เน็ตบ้านล่มแล้วเว็บยังเปิดดูได้"
 *
 * ไฟล์นี้เป็น **เทมเพลต** ไม่ได้ถูกรันตรงๆ: `src/pwa/integration.mjs` จะแทนที่
 * `__SW_VERSION__` / `__SW_PRECACHE__` ตอน build แล้วเขียนออกเป็น `dist/client/sw.js`
 *
 * กติกา cache
 *   shell   (ผูกกับเวอร์ชัน) — `_astro/*`, ไอคอน, manifest, หน้า /offline → cache-first
 *   pages   (ผูกกับเวอร์ชัน) — HTML ของแต่ละหน้า → network-first แล้ว fallback cache
 *   data    (ผูกกับเวอร์ชัน) — GET /api/* → network-first แล้ว fallback cache
 *   runtime (ไม่ผูกเวอร์ชัน) — ฟอนต์ Google + รูปใน public → stale-while-revalidate
 *
 * cache ที่ผูกเวอร์ชันจะถูกล้างทุกครั้งที่ deploy ใหม่ เพื่อไม่ให้ HTML เก่าชี้ไป
 * chunk ที่ไม่มีแล้ว — ตอน activate จึง warm หน้าหลักกลับมาทันทีในจังหวะเดียวกัน
 */

const VERSION = '__SW_VERSION__'
const PRECACHE_URLS = __SW_PRECACHE__

const SHELL_CACHE = `ourkk-shell-${VERSION}`
const PAGE_CACHE = `ourkk-pages-${VERSION}`
const DATA_CACHE = `ourkk-data-${VERSION}`
const RUNTIME_CACHE = 'ourkk-runtime'
const OWNED_CACHES = [SHELL_CACHE, PAGE_CACHE, DATA_CACHE, RUNTIME_CACHE]

const OFFLINE_URL = '/offline'
/** หน้าที่อุ่นเก็บไว้ล่วงหน้า เพื่อให้กดดูได้แม้ยังไม่เคยเปิดหน้านั้นตอนออนไลน์ */
const WARM_URLS = ['/', '/electricity/load', '/electricity/solar', '/electricity/bill', '/electricity/water', '/network']
/** ไม่ warm ซ้ำถ้าสำเนาที่มีอายุน้อยกว่านี้ */
const WARM_MAX_AGE_MS = 10 * 60 * 1000
const PAGE_CACHE_LIMIT = 40
const DATA_CACHE_LIMIT = 60
const RUNTIME_CACHE_LIMIT = 80
const NAVIGATION_TIMEOUT_MS = 6000
const DATA_TIMEOUT_MS = 8000
const CACHED_AT_HEADER = 'x-ourkk-cached-at'

/** ห้ามแตะเด็ดขาด — auth, health check, socket.io และ QR ที่ลายเซ็นหมดอายุได้ */
const BYPASS_PREFIXES = ['/api/auth', '/api/health', '/api/qr', '/socket.io', '/@vite', '/@id', '/node_modules']
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com']

/** สถานะล่าสุดที่ประกาศให้หน้าเว็บรู้ ใช้กันไม่ให้ broadcast รัวทุก request */
let lastBroadcastOnline = null

// ── helpers ────────────────────────────────────────────────────────────────

const now = () => Date.now()

/**
 * timeout แบบไม่แตะตัว request
 *
 * ส่ง init เข้า `fetch(request, init)` จะเข้าเงื่อนไข "init is not empty" ของ Request constructor
 * ซึ่งลด mode "navigate" เป็น "same-origin" ให้อัตโนมัติ — พฤติกรรม redirect ของ navigation
 * จะเพี้ยนไปโดยไม่มี error ให้เห็น จึงยอมแลกกับการที่ abort request ค้างไม่ได้
 */
function fetchWithTimeout(request, timeoutMs) {
  let timer
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('ourkk: network timeout')), timeoutMs)
  })
  return Promise.race([fetch(request), timeout]).finally(() => clearTimeout(timer))
}

/** ประทับเวลาไว้ในสำเนาที่ cache เพื่อให้หน้าเว็บบอกได้ว่า "ข้อมูลนี้เก่าแค่ไหน" */
async function stamped(response) {
  if (!response || response.type === 'opaque' || response.status === 0) return response
  const body = await response.clone().arrayBuffer()
  const headers = new Headers(response.headers)
  headers.set(CACHED_AT_HEADER, new Date().toISOString())
  return new Response(body, { status: response.status, statusText: response.statusText, headers })
}

function cachedAtOf(response) {
  const raw = response ? response.headers.get(CACHED_AT_HEADER) : null
  if (!raw) return null
  const value = Date.parse(raw)
  return Number.isFinite(value) ? value : null
}

/** Cache API ไม่มี LRU ในตัว — ตัดตัวที่ใส่ไว้นานสุดออกเมื่อเกินโควตา */
async function trimCache(cacheName, limit) {
  const cache = await caches.open(cacheName)
  const keys = await cache.keys()
  if (keys.length <= limit) return
  await Promise.all(keys.slice(0, keys.length - limit).map((key) => cache.delete(key)))
}

async function broadcast(message) {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  for (const client of windows) client.postMessage(message)
}

/** บอกหน้าเว็บทันทีที่ service worker เห็นสถานะเปลี่ยน — เร็วกว่ารอ probe รอบถัดไป */
function reportReachability(online) {
  if (lastBroadcastOnline === online) return
  lastBroadcastOnline = online
  void broadcast({ type: 'ourkk:reachability', online, at: now() })
}

// ── install ────────────────────────────────────────────────────────────────

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE)
      // ใส่ทีละไฟล์แทน addAll — ไฟล์เดียวพังไม่ควรทำให้ install ล้มทั้งชุด
      await Promise.all(
        PRECACHE_URLS.map(async (url) => {
          try {
            const response = await fetch(new Request(url, { cache: 'reload', credentials: 'same-origin' }))
            if (response.ok) await cache.put(url, await stamped(response))
          } catch {
            /* ไฟล์นี้ค่อยเก็บตอน runtime */
          }
        }),
      )
    })(),
  )
})

// ── activate ───────────────────────────────────────────────────────────────

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(names.filter((name) => name.startsWith('ourkk-') && !OWNED_CACHES.includes(name)).map((name) => caches.delete(name)))
      await self.clients.claim()
      // activate เกิดได้เฉพาะตอนโหลด sw.js ใหม่สำเร็จ = ออนไลน์อยู่แน่ ๆ
      // จึงอุ่นหน้าหลักกลับมาเลย ไม่ต้องรอผู้ใช้เดินเข้าไปทีละหน้า
      await warmPages()
    })(),
  )
})

// ── warm ───────────────────────────────────────────────────────────────────

async function warmPages() {
  const cache = await caches.open(PAGE_CACHE)
  await Promise.all(
    WARM_URLS.map(async (url) => {
      const existing = await cache.match(url)
      const cachedAt = cachedAtOf(existing)
      if (cachedAt !== null && now() - cachedAt < WARM_MAX_AGE_MS) return
      try {
        const response = await fetch(new Request(url, { credentials: 'same-origin', redirect: 'follow' }))
        // redirected = โดนเด้งไป /login → ไม่ใช่เนื้อหาของ URL นี้ ห้ามเก็บ
        if (response.ok && !response.redirected) await cache.put(url, await stamped(response))
      } catch {
        /* ออฟไลน์อยู่ — ของเดิมใน cache ยังใช้ได้ */
      }
    }),
  )
  await trimCache(PAGE_CACHE, PAGE_CACHE_LIMIT)
}

// ── fetch strategies ───────────────────────────────────────────────────────

async function handleNavigation(request, event) {
  const cache = await caches.open(PAGE_CACHE)
  try {
    const response = await fetchWithTimeout(request, NAVIGATION_TIMEOUT_MS)
    reportReachability(true)
    // opaqueredirect (status 0) = เซิร์ฟเวอร์เด้งไป /login — ส่งต่อให้เบราว์เซอร์ตามเอง ห้าม cache
    if (response.ok && response.type !== 'opaqueredirect' && !response.redirected) {
      const copy = await stamped(response)
      event.waitUntil(cache.put(request, copy).then(() => trimCache(PAGE_CACHE, PAGE_CACHE_LIMIT)))
    }
    return response
  } catch {
    reportReachability(false)
    const cached = (await cache.match(request)) || (await cache.match(request, { ignoreSearch: true }))
    if (cached) return cached
    const offline = await caches.match(OFFLINE_URL, { cacheName: SHELL_CACHE })
    if (offline) return offline
    return new Response('<!doctype html><meta charset="utf-8"><title>ออฟไลน์</title><p>ยังไม่มีสำเนาของหน้านี้ไว้ใช้ตอนออฟไลน์</p>', {
      status: 503,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    })
  }
}

/** ไฟล์ที่ชื่อมี hash — เนื้อหาเปลี่ยนไม่ได้ จึงหยิบจาก cache ก่อนเสมอ */
async function handleImmutable(request, event) {
  const cache = await caches.open(SHELL_CACHE)
  const cached = await cache.match(request)
  if (cached) return cached
  const response = await fetch(request)
  if (response.ok) event.waitUntil(cache.put(request, response.clone()))
  return response
}

/** ฟอนต์/รูป — คืนของใน cache ทันที แล้วค่อยอัปเดตเบื้องหลัง */
async function handleStaleWhileRevalidate(request, event) {
  const cache = await caches.open(RUNTIME_CACHE)
  const cached = await cache.match(request)
  const network = fetch(request)
    .then(async (response) => {
      if (response.ok || response.type === 'opaque') {
        await cache.put(request, response.clone())
        await trimCache(RUNTIME_CACHE, RUNTIME_CACHE_LIMIT)
      }
      return response
    })
    .catch(() => null)

  if (cached) {
    event.waitUntil(network)
    return cached
  }
  const response = await network
  return response || new Response('', { status: 504, statusText: 'offline' })
}

async function handleData(request, event) {
  const cache = await caches.open(DATA_CACHE)
  try {
    const response = await fetchWithTimeout(request, DATA_TIMEOUT_MS)
    reportReachability(true)
    if (response.ok) {
      const copy = await stamped(response)
      event.waitUntil(cache.put(request, copy).then(() => trimCache(DATA_CACHE, DATA_CACHE_LIMIT)))
    }
    return response
  } catch {
    reportReachability(false)
    const cached = await cache.match(request)
    if (cached) return cached
    return new Response(JSON.stringify({ offline: true, error: 'ออฟไลน์ — ไม่มีข้อมูลที่บันทึกไว้' }), {
      status: 503,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    })
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  const sameOrigin = url.origin === self.location.origin

  if (sameOrigin && BYPASS_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) return
  if (!sameOrigin && !FONT_HOSTS.includes(url.hostname)) return
  // range request (วิดีโอ/เสียง) ตอบจาก cache ไม่ได้
  if (request.headers.has('range')) return

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request, event))
    return
  }

  if (!sameOrigin) {
    event.respondWith(handleStaleWhileRevalidate(request, event))
    return
  }

  if (url.pathname.startsWith('/_astro/')) {
    event.respondWith(handleImmutable(request, event))
    return
  }

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(handleData(request, event))
    return
  }

  event.respondWith(handleStaleWhileRevalidate(request, event))
})

// ── ข้อความจากหน้าเว็บ ─────────────────────────────────────────────────────

self.addEventListener('message', (event) => {
  const data = event.data
  if (!data || typeof data !== 'object') return
  const port = event.ports && event.ports[0]
  const reply = (payload) => port && port.postMessage(payload)

  switch (data.type) {
    case 'ourkk:skip-waiting':
      void self.skipWaiting()
      break

    case 'ourkk:warm':
      event.waitUntil(warmPages())
      break

    // หน้าเว็บถามว่า "HTML ที่กำลังดูอยู่ถูกบันทึกไว้เมื่อไหร่" เพื่อบอกผู้ใช้ตอนออฟไลน์
    case 'ourkk:cache-info':
      event.waitUntil(
        (async () => {
          const cache = await caches.open(PAGE_CACHE)
          const cached = (await cache.match(data.url)) || (await cache.match(data.url, { ignoreSearch: true }))
          reply({ type: 'ourkk:cache-info', version: VERSION, cachedAt: cachedAtOf(cached) })
        })(),
      )
      break

    // ออกจากระบบ = ล้างทุกอย่าง ไม่ให้ HTML ของเจ้าของบ้านค้างในเครื่อง
    case 'ourkk:clear-caches':
      event.waitUntil(
        (async () => {
          const names = await caches.keys()
          await Promise.all(names.filter((name) => name.startsWith('ourkk-')).map((name) => caches.delete(name)))
          reply({ type: 'ourkk:clear-caches', ok: true })
        })(),
      )
      break

    default:
      break
  }
})
