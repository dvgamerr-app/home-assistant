/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'

/**
 * รันเทมเพลต service worker จริงใน scope จำลอง (self / caches / fetch / Request ปลอม)
 *
 * เหตุผลที่ต้องเทสต์ระดับนี้: ข้อกำหนดของหน้านี้คือ "เน็ตล่มแล้วเว็บยังเปิดได้" ซึ่งพิสูจน์ได้
 * ที่เดียวคือพฤติกรรมของ fetch handler ตอน network โยน error — เอามาเทียบด้วยตาไม่ได้
 */

const ORIGIN = 'https://home.ourkk.com'
const PRECACHE = ['/offline', '/manifest.webmanifest', '/_astro/app.abc123.js']

type SwRequest = { method: string; url: string; mode: string; headers: Headers }

const absolute = (url: string) => new URL(url, ORIGIN).href
const keyOf = (request: SwRequest | string) => (typeof request === 'string' ? absolute(request) : request.url)

function request(url: string, overrides: Partial<SwRequest> = {}): SwRequest {
  return { method: 'GET', url: absolute(url), mode: 'no-cors', headers: new Headers(), ...overrides }
}

const navigation = (url: string) => request(url, { mode: 'navigate' })

/** Request ปลอมที่ยอมรับ path สัมพัทธ์แบบเดียวกับใน worker จริง (global Request ของ bun ไม่ยอม) */
class SwRequestImpl implements SwRequest {
  method = 'GET'
  mode = 'no-cors'
  headers = new Headers()
  url: string
  constructor(input: string | SwRequest) {
    this.url = keyOf(input)
  }
}

class FakeCache {
  readonly entries = new Map<string, Response>()

  async put(key: SwRequest | string, response: Response) {
    this.entries.set(keyOf(key), response)
  }

  // Cache API จริงคืน Response ใหม่ทุกครั้ง — ถ้าคืนตัวเดิม body จะถูกอ่านได้ครั้งเดียว
  async match(key: SwRequest | string, options?: { ignoreSearch?: boolean }) {
    const wanted = keyOf(key)
    const direct = this.entries.get(wanted)
    if (direct) return direct.clone()
    if (!options?.ignoreSearch) return undefined
    const bare = wanted.split('?')[0]
    for (const [stored, response] of this.entries) {
      if (stored.split('?')[0] === bare) return response.clone()
    }
    return undefined
  }

  async keys() {
    return [...this.entries.keys()].map((url) => request(url))
  }

  async delete(key: SwRequest | string) {
    return this.entries.delete(keyOf(key))
  }
}

class FakeCacheStorage {
  readonly opened = new Map<string, FakeCache>()

  async open(name: string) {
    const existing = this.opened.get(name)
    if (existing) return existing
    const created = new FakeCache()
    this.opened.set(name, created)
    return created
  }

  async keys() {
    return [...this.opened.keys()]
  }

  async delete(name: string) {
    return this.opened.delete(name)
  }

  async match(key: SwRequest | string, options?: { cacheName?: string }) {
    if (options?.cacheName) return (await this.open(options.cacheName)).match(key)
    for (const cache of this.opened.values()) {
      const hit = await cache.match(key)
      if (hit) return hit
    }
    return undefined
  }
}

class FakeEvent {
  readonly waits: Promise<unknown>[] = []
  response: Promise<Response> | null = null
  constructor(
    readonly request: SwRequest,
    readonly data?: unknown,
    readonly ports?: { postMessage: (value: unknown) => void }[],
  ) {}
  respondWith(value: Promise<Response> | Response) {
    this.response = Promise.resolve(value)
  }
  waitUntil(value: Promise<unknown>) {
    this.waits.push(value)
  }
  /**
   * รอ side-effect (เขียน cache) ให้จบก่อนตรวจผล
   *
   * handler เรียก `waitUntil()` หลัง `await` หลายชั้น — เช็ค `waits` ทันทีที่ listener คืนค่า
   * จะเจอ array ว่างเสมอ จึงต้องรอ response ก่อน แล้ววนเก็บงานที่เพิ่งถูกใส่เข้ามาจนหมด
   */
  async settle() {
    if (this.response) await this.response
    while (this.waits.length > 0) await Promise.all(this.waits.splice(0))
  }
}

type Listener = (event: FakeEvent) => void

class FakeScope {
  readonly listeners = new Map<string, Listener[]>()
  readonly location = { origin: ORIGIN }
  readonly clients = {
    matchAll: async () => [] as { postMessage: (value: unknown) => void }[],
    claim: async () => undefined,
  }
  skipWaiting = async () => undefined
  addEventListener(type: string, listener: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }
  async dispatch(type: string, event: FakeEvent) {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
    await event.settle()
    return event
  }
}

type FetchImpl = (input: SwRequest | string) => Promise<Response>

async function loadServiceWorker(fetchImpl: FetchImpl) {
  const template = await readFile('src/pwa/service-worker.js', 'utf8')
  const source = template.replace("const VERSION = '__SW_VERSION__'", 'const VERSION = "test"').replace('const PRECACHE_URLS = __SW_PRECACHE__', `const PRECACHE_URLS = ${JSON.stringify(PRECACHE)}`)

  const scope = new FakeScope()
  const caches = new FakeCacheStorage()
  const factory = new Function('self', 'caches', 'fetch', 'Request', source) as (scope: FakeScope, caches: FakeCacheStorage, fetchImpl: FetchImpl, requestImpl: typeof SwRequestImpl) => void
  factory(scope, caches, fetchImpl, SwRequestImpl)
  return { scope, caches }
}

const html = (body: string) => new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })

/** เซิร์ฟเวอร์ที่ตอบทุกอย่างตามปกติ */
const serverUp: FetchImpl = async (input) => {
  const url = keyOf(input)
  if (url.endsWith('/api/solar/five-min')) return Response.json({ pv: [1, 2, 3] })
  return html(`<!doctype html><title>${new URL(url).pathname}</title>`)
}

/** เน็ตบ้านล่ม — ทุก request โยน error แบบเดียวกับ fetch จริง */
const serverDown: FetchImpl = async () => {
  throw new TypeError('Failed to fetch')
}

describe('service worker ตอนเซิร์ฟเวอร์ล่ม', () => {
  test('install เก็บไฟล์ใน precache ครบ', async () => {
    const { scope, caches } = await loadServiceWorker(serverUp)
    await scope.dispatch('install', new FakeEvent(request('/')))

    const shell = await caches.open('ourkk-shell-test')
    expect([...shell.entries.keys()].sort()).toEqual(PRECACHE.map(absolute).sort())
  })

  test('install ไม่ล้มทั้งชุดเพราะไฟล์เดียวโหลดไม่ได้', async () => {
    const flaky: FetchImpl = async (input) => {
      if (keyOf(input).endsWith('/manifest.webmanifest')) throw new TypeError('Failed to fetch')
      return html('ok')
    }
    const { scope, caches } = await loadServiceWorker(flaky)
    await scope.dispatch('install', new FakeEvent(request('/')))

    const shell = await caches.open('ourkk-shell-test')
    expect(shell.entries.has(absolute('/offline'))).toBe(true)
    expect(shell.entries.has(absolute('/manifest.webmanifest'))).toBe(false)
  })

  test('เปิดหน้าตอนออนไลน์แล้วเก็บสำเนาไว้ · เน็ตล่มแล้วยังเปิดหน้านั้นได้', async () => {
    let online = true
    const { scope } = await loadServiceWorker(async (input) => (online ? serverUp(input) : serverDown(input)))

    const first = await scope.dispatch('fetch', new FakeEvent(navigation('/electricity/load')))
    expect(await (await first.response!).text()).toContain('/electricity/load')

    online = false
    const offline = await scope.dispatch('fetch', new FakeEvent(navigation('/electricity/load')))
    const served = await offline.response!
    expect(served.status).toBe(200)
    expect(await served.text()).toContain('/electricity/load')
    // ประทับเวลาไว้ให้หน้าเว็บบอกผู้ใช้ได้ว่าข้อมูลเก่าแค่ไหน
    expect(served.headers.get('x-ourkk-cached-at')).toBeTruthy()
  })

  test('หน้าที่ไม่เคยเปิดตอนออนไลน์ ตกไปที่หน้า /offline', async () => {
    let online = true
    const { scope } = await loadServiceWorker(async (input) => (online ? serverUp(input) : serverDown(input)))
    await scope.dispatch('install', new FakeEvent(request('/')))

    online = false
    const event = await scope.dispatch('fetch', new FakeEvent(navigation('/settings')))
    const served = await event.response!
    expect(served.status).toBe(200)
    expect(await served.text()).toContain('/offline')
  })

  test('ไม่มีแม้แต่หน้า /offline ก็ยังตอบ 503 พร้อมข้อความ ไม่ปล่อยจอขาว', async () => {
    const { scope } = await loadServiceWorker(serverDown)
    const event = await scope.dispatch('fetch', new FakeEvent(navigation('/network')))
    const served = await event.response!
    expect(served.status).toBe(503)
    expect(await served.text()).toContain('ออฟไลน์')
  })

  test('ถูกเด้งไป /login ต้องไม่ถูกเก็บทับสำเนาของหน้าเดิม', async () => {
    const { scope, caches } = await loadServiceWorker(serverUp)
    await scope.dispatch('fetch', new FakeEvent(navigation('/')))

    // session หมดอายุ → เซิร์ฟเวอร์ตอบ redirect (opaqueredirect = status 0 ใน navigation request)
    const { scope: expired, caches: expiredCaches } = await loadServiceWorker(async () => new Response(null, { status: 302, headers: { location: '/login' } }))
    await expired.dispatch('fetch', new FakeEvent(navigation('/')))

    expect((await caches.open('ourkk-pages-test')).entries.size).toBe(1)
    expect((await expiredCaches.open('ourkk-pages-test')).entries.size).toBe(0)
  })

  test('API ที่เคยเรียกสำเร็จ ยังคืนค่าเดิมได้ตอนออฟไลน์ · ที่ไม่เคยเรียกตอบ 503 แบบอ่านออก', async () => {
    let online = true
    const { scope } = await loadServiceWorker(async (input) => (online ? serverUp(input) : serverDown(input)))
    await scope.dispatch('fetch', new FakeEvent(request('/api/solar/five-min')))

    online = false
    const cached = await scope.dispatch('fetch', new FakeEvent(request('/api/solar/five-min')))
    expect(await (await cached.response!).json()).toEqual({ pv: [1, 2, 3] })

    const missing = await scope.dispatch('fetch', new FakeEvent(request('/api/solar/five-min?date=2026-01-01')))
    const response = await missing.response!
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ offline: true })
  })

  test('ไม่แตะ auth, health, socket.io และ request ที่ไม่ใช่ GET', async () => {
    const { scope } = await loadServiceWorker(serverUp)
    for (const untouched of [request('/api/auth/sign-out', { method: 'POST' }), request('/api/auth/session'), request('/api/health'), request('/socket.io/?EIO=4'), request('/api/qr/bill.png')]) {
      const event = await scope.dispatch('fetch', new FakeEvent(untouched))
      expect(event.response).toBeNull()
    }
  })

  test('activate ล้าง cache ของเวอร์ชันก่อนหน้าแล้วอุ่นหน้าหลักกลับมา', async () => {
    const { scope, caches } = await loadServiceWorker(serverUp)
    await caches.open('ourkk-pages-เก่า')
    await caches.open('cache-ของระบบอื่น')

    await scope.dispatch('activate', new FakeEvent(request('/')))

    expect(await caches.keys()).not.toContain('ourkk-pages-เก่า')
    expect(await caches.keys()).toContain('cache-ของระบบอื่น')
    // warm ไว้ให้กดดูได้แม้ยังไม่เคยเปิดหน้านั้นเอง
    expect((await caches.open('ourkk-pages-test')).entries.has(absolute('/network'))).toBe(true)
  })

  test('ตอบคำถาม "หน้านี้เก็บไว้เมื่อไหร่" ให้หน้าเว็บ', async () => {
    const { scope } = await loadServiceWorker(serverUp)
    await scope.dispatch('fetch', new FakeEvent(navigation('/')))

    const replies: unknown[] = []
    await scope.dispatch('message', new FakeEvent(request('/'), { type: 'ourkk:cache-info', url: absolute('/') }, [{ postMessage: (value) => replies.push(value) }]))

    expect(replies).toHaveLength(1)
    expect(replies[0]).toMatchObject({ type: 'ourkk:cache-info', version: 'test' })
    expect((replies[0] as { cachedAt: number | null }).cachedAt).toBeGreaterThan(0)
  })

  test('ออกจากระบบแล้วล้างสำเนาของบ้านออกจากเครื่อง', async () => {
    const { scope, caches } = await loadServiceWorker(serverUp)
    await scope.dispatch('install', new FakeEvent(request('/')))
    await scope.dispatch('fetch', new FakeEvent(navigation('/')))
    await caches.open('cache-ของระบบอื่น')

    const replies: unknown[] = []
    await scope.dispatch('message', new FakeEvent(request('/'), { type: 'ourkk:clear-caches' }, [{ postMessage: (value) => replies.push(value) }]))

    expect((await caches.keys()).filter((name) => name.startsWith('ourkk-'))).toEqual([])
    expect(await caches.keys()).toContain('cache-ของระบบอื่น')
    expect(replies[0]).toMatchObject({ ok: true })
  })
})
