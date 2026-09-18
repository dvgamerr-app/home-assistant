/**
 * Mock ของหน้า "เครือข่ายในบ้าน" — โครงข้อมูลตรงกับ `stash.pingstats` ของ collector
 * (ts, host, section, latency_ms, error_code, responder) เพื่อให้เปลี่ยนไปอ่าน DB จริง
 * ได้โดยแก้เฉพาะไฟล์นี้ ไม่ต้องแตะหน้า/คอมโพเนนต์
 *
 * ทุกตัวเลขในไฟล์นี้เป็นค่าจำลอง (อิงช่วงค่าที่วัดได้จริง) — ยังไม่ได้ query DB
 */

export type NetworkHopId = 'local' | 'wan' | 'dns' | 'intl'
export type NetworkStatus = 'good' | 'warn' | 'down'

export interface NetworkHop {
  id: NetworkHopId
  /** ชื่อ section ใน stash.pingstats */
  section: string
  /** ชื่อที่เจ้าของบ้านเข้าใจ */
  label: string
  /** อธิบายว่า hop นี้พังแล้วกระทบอะไร */
  meaning: string
  /** ปลายทางที่ ping (คอลัมน์ responder) */
  target: string
  color: string
  latencyMs: number
  avgMs: number
  p95Ms: number
  maxMs: number
  jitterMs: number
  lossPct: number
  /** เกณฑ์ "ปกติ" ของ hop นี้ ใช้ทั้งข้อความและความยาวแถบ */
  goodMs: number
  status: NetworkStatus
  /** ค่าปกติ 0..1 สำหรับ sparkline 24 ชม. */
  spark: number[]
}

export interface NetworkSeries {
  id: NetworkHopId
  label: string
  color: string
  /** ความหน่วงเฉลี่ยรายช่วง 10 นาที ตลอด 24 ชม. (null = ไม่ตอบ) */
  points: (number | null)[]
}

export interface NetworkHour {
  hour: number
  /** สัดส่วนแพ็กเก็ตที่หายในชั่วโมงนั้น (%) */
  lossPct: number
  /** วินาทีที่เน็ตใช้งานไม่ได้ */
  downSec: number
  /** ความหน่วงออกเน็ตเฉลี่ยในชั่วโมงนั้น */
  wanMs: number
}

export interface NetworkIncident {
  startedAt: Date
  durationSec: number
  hop: NetworkHopId
  title: string
  detail: string
  severity: 'down' | 'warn'
}

export interface NetworkOverview {
  online: boolean
  uptimePctToday: number
  latencyMs: number
  /** ค่าเฉลี่ยย้อนหลัง 7 วัน ใช้เทียบว่าวันนี้ช้ากว่าปกติไหม */
  baselineMs: number
  jitterMs: number
  lossPct24h: number
  samples24h: number
  downSecToday: number
}

export interface NetworkSnapshot {
  /** คอลัมน์ host — เครื่องที่ยิง ping */
  probeHost: string
  sampleIntervalSec: number
  updatedAt: Date
  overview: NetworkOverview
  hops: NetworkHop[]
  series: NetworkSeries[]
  hourly: NetworkHour[]
  incidents: NetworkIncident[]
  /** รายชื่ออุปกรณ์ในบ้าน — ยังไม่มีแหล่งข้อมูล (ต้องต่อ API เราเตอร์) */
  devices: null
}

/** RNG แบบ seed คงที่ เพื่อให้ mock ออกมาเหมือนเดิมทุกครั้งที่ render */
function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const BUCKETS = 144 // 24 ชม. ช่วงละ 10 นาที
const OUTAGE_FROM = 13 // 02:10
const OUTAGE_TO = 15 // 02:30
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0
const percentile = (values: number[], p: number) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * p))] ?? 0
const round = (value: number, digits = 1) => Number(value.toFixed(digits))

type HopSpec = Pick<NetworkHop, 'id' | 'section' | 'label' | 'meaning' | 'target' | 'color' | 'goodMs'> & {
  base: number
  noise: number
  /** ตัวคูณช่วงเย็นที่คนใช้เน็ตเยอะ */
  eveningFactor: number
  /** หยุดตอบเมื่อเน็ตหลุด */
  dropsOnOutage: boolean
}

const HOPS: HopSpec[] = [
  {
    id: 'local',
    section: 'Local',
    label: 'เราเตอร์ในบ้าน',
    meaning: 'สายในบ้านและ Wi-Fi ถึงเราเตอร์',
    target: '10.203.1.91',
    color: 'var(--chart-1)',
    goodMs: 2,
    base: 0.48,
    noise: 0.12,
    eveningFactor: 1.15,
    dropsOnOutage: false,
  },
  {
    id: 'wan',
    section: 'WAN (Internet)',
    label: 'ผู้ให้บริการอินเทอร์เน็ต',
    meaning: 'ทางออกจากบ้านไปยังเครือข่ายผู้ให้บริการ',
    target: '171.6.8.1',
    color: 'var(--chart-2)',
    goodMs: 12,
    base: 6.6,
    noise: 1.1,
    eveningFactor: 1.5,
    dropsOnOutage: true,
  },
  {
    id: 'dns',
    section: 'DNS',
    label: 'ระบบค้นหาชื่อเว็บ',
    meaning: 'แปลชื่อเว็บเป็นที่อยู่ — ช้าแล้วเว็บจะหน่วงตอนเปิด',
    target: '1.1.1.1',
    color: 'var(--chart-3)',
    goodMs: 15,
    base: 6.8,
    noise: 1.0,
    eveningFactor: 1.35,
    dropsOnOutage: true,
  },
  {
    id: 'intl',
    section: 'Singapore',
    label: 'ปลายทางต่างประเทศ',
    meaning: 'เส้นทางออกนอกประเทศ — กระทบสตรีมมิงและเกม',
    target: '139.162.23.4',
    color: 'var(--chart-5)',
    goodMs: 45,
    base: 32.5,
    noise: 1.6,
    eveningFactor: 1.35,
    dropsOnOutage: true,
  },
]

function buildSeries(spec: HopSpec, random: () => number): (number | null)[] {
  return Array.from({ length: BUCKETS }, (_, index) => {
    if (spec.dropsOnOutage && index >= OUTAGE_FROM && index < OUTAGE_TO) return null

    const hour = (index * 10) / 60
    // คนในบ้านใช้เน็ตหนักช่วง 19:00–23:00 → ความหน่วงสูงขึ้นเป็นเนิน
    const evening = Math.max(0, 1 - Math.abs(hour - 21) / 2.5)
    const busy = 1 + (spec.eveningFactor - 1) * evening
    const spike = random() < 0.012 ? spec.base * (1.6 + random() * 2.4) : 0
    return round(spec.base * busy + (random() - 0.5) * spec.noise + spike, 2)
  })
}

export function getNetworkSnapshot(now = new Date()): NetworkSnapshot {
  const random = mulberry32(20260917)
  const series = HOPS.map((spec) => ({ spec, points: buildSeries(spec, random) }))

  const hops: NetworkHop[] = series.map(({ spec, points }) => {
    const alive = points.filter((point): point is number => point !== null)
    const lossPct = spec.dropsOnOutage ? round(((points.length - alive.length) / points.length) * 100, 2) : 0
    const latencyMs = round(alive.at(-1) ?? 0, 1)
    const avgMs = round(alive.reduce((sum, value) => sum + value, 0) / alive.length, 1)
    const p95Ms = round(percentile(alive, 0.95), 1)
    const maxMs = round(Math.max(...alive), 1)
    const mid = median(alive)
    const jitterMs = round(alive.reduce((sum, value) => sum + Math.abs(value - mid), 0) / alive.length, 2)
    const status: NetworkStatus = lossPct > 1 ? 'down' : p95Ms > spec.goodMs ? 'warn' : 'good'
    const sparkMax = Math.max(...alive)

    return {
      id: spec.id,
      section: spec.section,
      label: spec.label,
      meaning: spec.meaning,
      target: spec.target,
      color: spec.color,
      goodMs: spec.goodMs,
      latencyMs,
      avgMs,
      p95Ms,
      maxMs,
      jitterMs,
      lossPct,
      status,
      spark: points.map((point) => (point === null ? 0 : point / sparkMax)),
    }
  })

  const hourly: NetworkHour[] = Array.from({ length: 24 }, (_, hour) => {
    const from = hour * 6
    const slice = series.find(({ spec }) => spec.id === 'wan')!.points.slice(from, from + 6)
    const alive = slice.filter((point): point is number => point !== null)
    const lossPct = round(((slice.length - alive.length) / slice.length) * 100, 1)
    return {
      hour,
      lossPct,
      downSec: (slice.length - alive.length) * 600,
      wanMs: alive.length > 0 ? round(alive.reduce((sum, value) => sum + value, 0) / alive.length, 1) : 0,
    }
  })

  const downSecToday = hourly.reduce((sum, item) => sum + item.downSec, 0)
  const wan = hops.find((hop) => hop.id === 'wan')!
  const sampleIntervalSec = 0.5
  const samples24h = Math.round((24 * 3600) / sampleIntervalSec) * HOPS.length
  const outageStart = new Date(now.getTime() - (BUCKETS - OUTAGE_FROM) * 10 * 60 * 1000)

  return {
    probeHost: 'AIDE-RYZEN',
    sampleIntervalSec,
    updatedAt: now,
    overview: {
      online: true,
      uptimePctToday: round(100 - (downSecToday / 86400) * 100, 2),
      latencyMs: wan.latencyMs,
      baselineMs: 6.4,
      jitterMs: wan.jitterMs,
      lossPct24h: wan.lossPct,
      samples24h,
      downSecToday,
    },
    hops,
    series: series.map(({ spec, points }) => ({ id: spec.id, label: spec.label, color: spec.color, points })),
    hourly,
    incidents: [
      {
        startedAt: outageStart,
        durationSec: (OUTAGE_TO - OUTAGE_FROM) * 600,
        hop: 'wan',
        title: 'อินเทอร์เน็ตหลุดชั่วคราว',
        detail: 'เราเตอร์ในบ้านยังตอบปกติ แต่ออกอินเทอร์เน็ตไม่ได้ — ต้นเหตุน่าจะอยู่ฝั่งผู้ให้บริการ',
        severity: 'down',
      },
      {
        startedAt: new Date(now.getTime() - 3 * 3600 * 1000),
        durationSec: 5400,
        hop: 'intl',
        title: 'เส้นทางต่างประเทศหน่วงกว่าปกติ',
        detail: 'ความหน่วงไปสิงคโปร์ขึ้นไปแตะ 48 ms ช่วงคนใช้งานเยอะ ดูสตรีมมิงอาจสะดุดบ้าง',
        severity: 'warn',
      },
    ],
    devices: null,
  }
}
