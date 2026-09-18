import { currentOutageSec, markOutageEnd, markOutageStart, outageSecToday, OUTAGE_LOG_KEY, parseOutageLog, serializeOutageLog, type OutageLog } from './offline-log'

/**
 * แหล่งความจริงเดียวของฝั่งเบราว์เซอร์ว่า "ตอนนี้คุยกับบ้านได้ไหม"
 *
 * `navigator.onLine` บอกได้แค่ว่ามีการ์ดเน็ตเสียบอยู่ — เน็ตบ้านล่มแต่ Wi-Fi ยังต่อ
 * อยู่ค่าก็ยังเป็น true ตัวตัดสินจริงคือ probe ไปที่ `/api/health` ของเซิร์ฟเวอร์เอง
 *
 * ทุกส่วนที่ต้องหยุด/เริ่มอัปเดตเรียลไทม์ (socket ของ EnergyFlow, SolarStatusCards
 * และกราฟทั้งสองตัว) subscribe ที่นี่ที่เดียว จะได้เปิดปิดพร้อมกันเสมอ
 */

export type ConnectivitySnapshot = {
  /** เซิร์ฟเวอร์ตอบอยู่หรือไม่ */
  online: boolean
  /** ยังไม่เคย probe สำเร็จสักครั้ง (ใช้กันไม่ให้ขึ้นแถบออฟไลน์แว้บตอนเปิดหน้า) */
  settled: boolean
  /** เวลาที่สถานะเปลี่ยนล่าสุด */
  changedAt: number
  /** ครั้งสุดท้ายที่คุยกับเซิร์ฟเวอร์ได้ */
  lastOnlineAt: number | null
  /** HTML ที่กำลังดูถูกบันทึกไว้เมื่อไหร่ (จาก service worker) — null = ยังไม่รู้ */
  cachedAt: number | null
  /** วินาทีที่หลุดต่อเนื่องอยู่ตอนนี้ */
  outageSec: number
  /** วินาทีที่เครื่องนี้เห็นว่าหลุด รวมทั้งวัน (เวลาไทย) */
  outageSecToday: number
  /** มี service worker เวอร์ชันใหม่รออยู่ */
  updateReady: boolean
}

type Listener = (snapshot: ConnectivitySnapshot) => void

const HEALTH_URL = '/api/health'
const PROBE_TIMEOUT_MS = 5000
const ONLINE_PROBE_MS = 30_000
const OFFLINE_BACKOFF_MS = [2000, 4000, 8000, 15_000, 30_000]
/** ระหว่างออฟไลน์ต้องขยับตัวเลข "หลุดมาแล้ว…" ให้เห็นว่ายังนับอยู่ */
const OUTAGE_TICK_MS = 10_000

/** หน่วงก่อน probe รอบถัดไป — ยิ่งพลาดติดกันยิ่งถอย เพื่อไม่ให้ยิงรัวตอนเน็ตล่มยาว */
export function probeDelayMs(consecutiveFailures: number): number {
  if (consecutiveFailures <= 0) return ONLINE_PROBE_MS
  return OFFLINE_BACKOFF_MS[Math.min(consecutiveFailures, OFFLINE_BACKOFF_MS.length) - 1] ?? ONLINE_PROBE_MS
}

const listeners = new Set<Listener>()

let log: OutageLog = { date: '', downSec: 0, openedAt: null }
let state: ConnectivitySnapshot = {
  online: true,
  settled: false,
  changedAt: 0,
  lastOnlineAt: null,
  cachedAt: null,
  outageSec: 0,
  outageSecToday: 0,
  updateReady: false,
}

let started = false
let failures = 0
let probeTimer: ReturnType<typeof setTimeout> | undefined
let outageTimer: ReturnType<typeof setInterval> | undefined
let inFlight = false
let registration: ServiceWorkerRegistration | null = null
let reloading = false

export function getConnectivity(): ConnectivitySnapshot {
  return state
}

/** คืนฟังก์ชัน unsubscribe — เรียก callback ทันทีหนึ่งครั้งด้วยค่าปัจจุบัน */
export function subscribeConnectivity(listener: Listener): () => void {
  listeners.add(listener)
  listener(state)
  return () => listeners.delete(listener)
}

function emit(patch: Partial<ConnectivitySnapshot>) {
  state = { ...state, ...patch }
  for (const listener of listeners) listener(state)
}

function syncDocumentFlag() {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.connectivity = state.online ? 'online' : 'offline'
}

function persistLog() {
  try {
    localStorage.setItem(OUTAGE_LOG_KEY, serializeOutageLog(log))
  } catch {
    /* โหมดส่วนตัว/โควตาเต็ม — ยอดของวันนี้หายได้ ไม่ถึงกับต้องพังทั้งหน้า */
  }
}

function refreshOutage(at: number) {
  emit({ outageSec: currentOutageSec(log, at), outageSecToday: outageSecToday(log, at) })
}

function setOnline(next: boolean, at = Date.now()) {
  const changed = next !== state.online || !state.settled
  log = next ? markOutageEnd(log, at) : markOutageStart(log, at)
  if (changed) persistLog()

  emit({
    online: next,
    settled: true,
    changedAt: changed ? at : state.changedAt,
    lastOnlineAt: next ? at : state.lastOnlineAt,
    outageSec: currentOutageSec(log, at),
    outageSecToday: outageSecToday(log, at),
  })
  syncDocumentFlag()

  if (next) {
    stopOutageTicker()
    // เพิ่งกลับมาออนไลน์ → ถามเวลา cache ใหม่ เผื่อ service worker เพิ่งรีเฟรชหน้านี้
    void refreshCacheInfo()
  } else {
    startOutageTicker()
  }
}

function startOutageTicker() {
  if (outageTimer !== undefined) return
  outageTimer = setInterval(() => refreshOutage(Date.now()), OUTAGE_TICK_MS)
}

function stopOutageTicker() {
  if (outageTimer === undefined) return
  clearInterval(outageTimer)
  outageTimer = undefined
}

async function probe(): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  try {
    const response = await fetch(`${HEALTH_URL}?t=${Date.now()}`, {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
      signal: controller.signal,
    })
    return response.ok
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

function schedule(delay: number) {
  clearTimeout(probeTimer)
  probeTimer = setTimeout(() => void runProbe(), delay)
}

async function runProbe() {
  if (inFlight) return
  // ไม่มีการ์ดเน็ตเลย = ออฟไลน์แน่นอน ไม่ต้องเสีย request
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    failures += 1
    setOnline(false)
    schedule(probeDelayMs(failures))
    return
  }

  inFlight = true
  try {
    const ok = await probe()
    failures = ok ? 0 : failures + 1
    setOnline(ok)
    schedule(probeDelayMs(failures))
  } finally {
    inFlight = false
  }
}

/** ให้ตรวจเดี๋ยวนี้ — ใช้ตอน socket หลุด, กลับมาโฟกัสแท็บ, หรือผู้ใช้กดลองใหม่ */
export function requestConnectivityProbe() {
  if (!started) return
  schedule(0)
}

// ── service worker ─────────────────────────────────────────────────────────

/** ถาม service worker ว่า HTML ของหน้านี้ที่เก็บไว้เป็นของเมื่อไหร่ */
function askServiceWorker<T>(message: Record<string, unknown>, timeoutMs = 3000): Promise<T | null> {
  const worker = navigator.serviceWorker?.controller
  if (!worker) return Promise.resolve(null)

  return new Promise<T | null>((resolve) => {
    const channel = new MessageChannel()
    const timer = setTimeout(() => {
      channel.port1.close()
      resolve(null)
    }, timeoutMs)
    channel.port1.onmessage = (event) => {
      clearTimeout(timer)
      channel.port1.close()
      resolve(event.data as T)
    }
    worker.postMessage(message, [channel.port2])
  })
}

async function refreshCacheInfo() {
  const info = await askServiceWorker<{ cachedAt: number | null }>({ type: 'ourkk:cache-info', url: location.href })
  if (info) emit({ cachedAt: info.cachedAt })
}

/** ใช้เวอร์ชันใหม่ที่รออยู่ แล้วโหลดหน้าใหม่เมื่อ service worker ตัวใหม่เข้าคุม */
export function applyServiceWorkerUpdate() {
  const waiting = registration?.waiting
  if (!waiting) {
    location.reload()
    return
  }
  reloading = true
  waiting.postMessage({ type: 'ourkk:skip-waiting' })
}

/** ล้างสำเนาหน้าเว็บทั้งหมดในเครื่อง — ใช้ตอนออกจากระบบ ไม่ให้ข้อมูลบ้านค้างไว้ */
export async function clearOfflineCaches() {
  try {
    await askServiceWorker({ type: 'ourkk:clear-caches' }, 2000)
    if ('caches' in window) {
      const names = await caches.keys()
      await Promise.all(names.filter((name) => name.startsWith('ourkk-')).map((name) => caches.delete(name)))
    }
  } catch {
    /* ล้างไม่ได้ก็ยังต้องออกจากระบบต่อ */
  }
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return

  // dev ไม่ลง service worker: HMR กับ HTML ที่ถูก cache ไว้จะตีกัน
  // และถ้าเครื่องเคยรัน `bun run preview` ที่พอร์ตเดียวกันมาก่อน ต้องถอนของเก่าออกด้วย
  if (!import.meta.env.PROD) {
    const existing = await navigator.serviceWorker.getRegistrations()
    await Promise.all(existing.map((item) => item.unregister()))
    return
  }

  try {
    registration = await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })

    if (registration.waiting && navigator.serviceWorker.controller) emit({ updateReady: true })

    registration.addEventListener('updatefound', () => {
      const installing = registration?.installing
      if (!installing) return
      installing.addEventListener('statechange', () => {
        // มี controller อยู่แล้ว = นี่คือการอัปเดต ไม่ใช่การติดตั้งครั้งแรก
        if (installing.state === 'installed' && navigator.serviceWorker.controller) emit({ updateReady: true })
      })
    })

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!reloading) return
      reloading = false
      location.reload()
    })

    navigator.serviceWorker.addEventListener('message', (event: MessageEvent) => {
      const data = event.data as { type?: string; online?: boolean } | null
      if (!data || data.type !== 'ourkk:reachability') return
      // เชื่อได้ทันทีเฉพาะขา "ต่อได้" — ขาหลุดอาจเป็นแค่ request เดียวที่ช้า จึงยืนยันด้วย probe
      if (data.online) {
        failures = 0
        setOnline(true)
        schedule(probeDelayMs(0))
      } else {
        requestConnectivityProbe()
      }
    })

    await navigator.serviceWorker.ready
    void refreshCacheInfo()
    // เก็บหน้าหลักให้ครบตั้งแต่ตอนที่ยังออนไลน์ (service worker throttle เองว่าจะดึงซ้ำเมื่อไหร่)
    navigator.serviceWorker.controller?.postMessage({ type: 'ourkk:warm' })
  } catch {
    /* ลง service worker ไม่ได้ (เช่นไม่ใช่ https) — เว็บยังใช้งานได้ตามปกติ แค่ไม่มีโหมดออฟไลน์ */
  }
}

// ── start ──────────────────────────────────────────────────────────────────

/** เรียกได้หลายครั้ง — ทำงานจริงครั้งเดียว */
export function startConnectivity() {
  if (started || typeof window === 'undefined') return
  started = true

  const at = Date.now()
  try {
    log = parseOutageLog(localStorage.getItem(OUTAGE_LOG_KEY), at)
  } catch {
    log = parseOutageLog(null, at)
  }
  emit({ outageSec: currentOutageSec(log, at), outageSecToday: outageSecToday(log, at) })
  syncDocumentFlag()

  window.addEventListener('online', () => requestConnectivityProbe())
  window.addEventListener('offline', () => {
    failures += 1
    setOnline(false)
    schedule(probeDelayMs(failures))
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') requestConnectivityProbe()
  })

  void registerServiceWorker()
  void runProbe()
}
