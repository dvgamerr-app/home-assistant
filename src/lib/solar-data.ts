import { calculateMonthlyBill, marginalRate } from './electricity'

// ----- System & investment assumptions (editable per install) -----
export const SYSTEM = {
  name: 'คุณกิ่งกาญจน์ 75/63',
  ratedPowerKw: 8, // from device "powerRating"
  batteryCapacityKwh: 10, // usable battery capacity (hybrid install)
  installDate: '2026-05-11',
  investmentTHB: 280000, // typical 8kW hybrid + battery install cost (THB)
  serialNumber: 'LIBIPS08EEEAF618',
}

// ----- Snapshot derived from the live device payload (the two JSON attachments) -----
// Raw telemetry -> meaningful "right now" state.
export const LIVE = {
  pvPowerKw: 3.406, // generationPower
  loadPowerKw: 1.175, // totalLoadPower
  batteryPowerKw: -2.231, // negative = charging
  batterySoc: 98, // %
  batterySoh: 100, // %
  gridPowerKw: 0, // aPhaseFeederPower
  isOnline: true,
  lastUpdate: '2026-06-12T05:14:50Z',
}

// ----- Battery detail (real device fields) + derived backup estimate -----
export const BATTERY = (() => {
  const soc = LIVE.batterySoc // %
  const soh = LIVE.batterySoh // %
  const powerKw = LIVE.batteryPowerKw // negative = charging, positive = discharging
  const voltage = 495.3 // Battery Voltage (V)
  const current = -4.5 // Battery Current (A), negative = charging
  const cyclePeriod = 42 // Cycle Period (charge cycles)
  const status = powerKw < -0.05 ? 'charging' : powerKw > 0.05 ? 'discharging' : 'idle'

  // Usable energy stored right now, and how long it could power the house if grid fails
  const storedKwh = (SYSTEM.batteryCapacityKwh * soc) / 100
  const backupHours = LIVE.loadPowerKw > 0 ? storedKwh / LIVE.loadPowerKw : 0

  return { soc, soh, powerKw, voltage, current, cyclePeriod, status, storedKwh, backupHours }
})()

// ----- Solar panel strings (real per-string telemetry) -----
export const PV_STRINGS = [
  { name: 'แผง MPPT 1', power: 3.406, voltage: 495.3, current: 6.8 },
  { name: 'แผง MPPT 2', power: 0, voltage: 0, current: 0 },
]

// ----- Inverter / system health (real device fields) -----
export const SYSTEM_HEALTH = {
  gridVoltage: 228.4, // Grid Output Voltage (V) — normal ~220-240
  gridFrequency: 50.01, // Hz — normal ~50
  inverterVoltage: 229.1, // Inverter Output Voltage (V)
  totalGenerationHours: 530, // Total Generation Time (hour)
  ratedPowerKw: SYSTEM.ratedPowerKw,
  // how hard the inverter is working right now vs its rated capacity
  get loadFactorPct() {
    return (LIVE.pvPowerKw / this.ratedPowerKw) * 100
  },
  // simple normal-range checks for a friendly "everything OK" indicator
  get gridVoltageOk() {
    return this.gridVoltage >= 210 && this.gridVoltage <= 245
  },
  get gridFrequencyOk() {
    return this.gridFrequency >= 49.5 && this.gridFrequency <= 50.5
  },
}

// ----- Today's energy figures (kWh) derived from the day counters -----
export const TODAY = {
  generated: 7.516, // dailyProducedQuantity
  consumed: 10.722, // loadDayElectricityConsumption
  gridImport: 4.287, // Day Purchase Electricity Consumption
  generationHours: 0.93, // dailyProducedTime
}

// ----- Lifetime totals -----
export const LIFETIME = {
  generated: 715.886, // totalPowerGeneration
  gridImport: 241.583, // Total Purchase Electricity Consumption
  generationHours: 530,
  co2ReductionKg: 704.38, // co2EmissionReduction
}

/**
 * Self-consumption from solar = consumed - grid import (what we didn't buy).
 * This is the real money-saver for a homeowner.
 */
function deriveDay() {
  const selfUse = Math.max(0, TODAY.consumed - TODAY.gridImport)
  // value avoided units at the marginal MEA price for a ~320 unit/month household
  const rate = marginalRate(320)
  const savedTHB = selfUse * rate
  const gridCostTHB = TODAY.gridImport * rate
  const wouldHaveCostTHB = TODAY.consumed * rate
  const selfSufficiency = TODAY.consumed > 0 ? (selfUse / TODAY.consumed) * 100 : 0
  return {
    selfUse,
    savedTHB,
    gridCostTHB,
    wouldHaveCostTHB,
    selfSufficiency,
  }
}

export const DAY = deriveDay()

// ----- Current month, day-by-day (1 → end of month) -----
const NOW = new Date(LIVE.lastUpdate)
const CURRENT_YEAR = NOW.getUTCFullYear()
const CURRENT_MONTH = NOW.getUTCMonth() // 0-indexed
const CURRENT_DAY = NOW.getUTCDate()
const DAYS_IN_MONTH = new Date(CURRENT_YEAR, CURRENT_MONTH + 1, 0).getDate()

const MONTH_NAME_TH = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'][CURRENT_MONTH]

export const CURRENT_MONTH_LABEL = `${MONTH_NAME_TH} ${CURRENT_YEAR + 543}`

// Deterministic pseudo-random so the chart is stable between renders
function seeded(n: number) {
  const x = Math.sin(n * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

// Daily breakdown for the whole month. Days after "today" have no data yet.
export const MONTH_DAYS = Array.from({ length: DAYS_IN_MONTH }, (_, i) => {
  const day = i + 1
  const isFuture = day > CURRENT_DAY
  if (isFuture) {
    return { day: String(day), generated: 0, consumed: 0, selfUse: 0, gridImport: 0, saved: 0 }
  }
  const r = seeded(day)
  const generated = +(26 + r * 12).toFixed(1) // 26–38 kWh/day
  const consumed = +(24 + seeded(day + 100) * 9).toFixed(1) // 24–33 kWh/day
  const selfUse = +Math.min(generated, consumed * (0.55 + seeded(day + 200) * 0.3)).toFixed(1)
  const gridImport = +Math.max(0, consumed - selfUse).toFixed(1)
  const rate = marginalRate(320)
  return {
    day: String(day),
    generated,
    consumed,
    selfUse,
    gridImport,
    saved: +(selfUse * rate).toFixed(1),
  }
})

// ----- 12-month history -----
const MONTH_LABELS = ['ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.']

// Seasonal generation profile (Thailand: high Nov–Apr dry season, dips in rainy Jul–Oct)
const GEN_PROFILE = [780, 760, 800, 820, 880, 910, 940, 950, 1010, 990, 870, 760]

export const MONTHS = MONTH_LABELS.map((label, i) => {
  const generated = GEN_PROFILE[i]
  const consumed = 920 + ((i * 37) % 140) // household load ~ 920-1060 units
  const selfUse = Math.min(generated, consumed) * 0.62 // realistic self-consumption ratio
  const gridImport = Math.max(0, consumed - selfUse)

  const billWithSolar = calculateMonthlyBill(gridImport)
  const billWithoutSolar = calculateMonthlyBill(consumed)
  const saved = billWithoutSolar.total - billWithSolar.total

  return {
    month: label,
    generated: Math.round(generated),
    consumed: Math.round(consumed),
    selfUse: Math.round(selfUse),
    gridImport: Math.round(gridImport),
    billWithSolar: billWithSolar.total,
    billWithoutSolar: billWithoutSolar.total,
    saved,
  }
})

// ----- Today by hour (00:00 → 23:00): production curve, load, battery SOC -----
// Bell-shaped solar curve peaking ~12:00, household load with morning/evening peaks.
export const HOURLY = Array.from({ length: 24 }, (_, h) => {
  // solar: 0 before 6:00 and after 18:00, bell curve in between
  const daylight = h >= 6 && h <= 18
  const bell = Math.exp(-Math.pow((h - 12.5) / 3.2, 2)) // 0..1
  const pv = daylight ? +(SYSTEM.ratedPowerKw * bell * 0.92).toFixed(2) : 0

  // household load: base + morning (6-8) + evening (18-22) peaks
  const morning = h >= 6 && h <= 8 ? 1.1 : 0
  const evening = h >= 18 && h <= 22 ? 1.8 : 0
  const load = +(0.45 + morning + evening + seeded(h) * 0.3).toFixed(2)

  // battery SOC: charges midday when pv > load, discharges evening/night
  const net = pv - load
  return { hour: `${String(h).padStart(2, '0')}:00`, pv, load, net: +net.toFixed(2) }
})

// derive a plausible battery SOC walk across the day from the net flow
export const HOURLY_SOC = (() => {
  let soc = 42 // start of day
  return HOURLY.map((row) => {
    // 1 kWh net ~ 10% of a 10 kWh battery, clamped 10–100
    soc = Math.max(10, Math.min(100, soc + row.net * 4))
    return { hour: row.hour, soc: Math.round(soc) }
  })
})()

// ----- Where the solar energy goes (lifetime split) -----
export const ENERGY_DISTRIBUTION = (() => {
  const selfUse = Math.round(LIFETIME.generated * 0.62)
  const toBattery = Math.round(LIFETIME.generated * 0.26)
  const exported = Math.max(0, Math.round(LIFETIME.generated - selfUse - toBattery))
  return [
    { name: 'ใช้ในบ้านทันที', value: selfUse, key: 'selfUse' },
    { name: 'เก็บเข้าแบตเตอรี่', value: toBattery, key: 'battery' },
    { name: 'ขายคืน/ส่งออก', value: exported, key: 'export' },
  ]
})()

// ----- Payback / ROI -----
export function derivePayback() {
  const monthlyAvgSaving = MONTHS.reduce((sum, m) => sum + m.saved, 0) / MONTHS.length
  const totalSavedToDate = monthlyAvgSaving * 1 // ~1 month since install (May 11)
  const remaining = SYSTEM.investmentTHB - totalSavedToDate
  const monthsToPayback = monthlyAvgSaving > 0 ? remaining / monthlyAvgSaving : 0
  const yearsToPayback = monthsToPayback / 12
  const progressPct = (totalSavedToDate / SYSTEM.investmentTHB) * 100
  return {
    monthlyAvgSaving,
    annualSaving: monthlyAvgSaving * 12,
    totalSavedToDate,
    remaining,
    monthsToPayback,
    yearsToPayback,
    progressPct,
  }
}

export const PAYBACK = derivePayback()
