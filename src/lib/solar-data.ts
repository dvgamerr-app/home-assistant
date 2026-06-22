import { calculateMonthlyBill, marginalRate } from './electricity'
import { getLiveSnapshot, getToday, getHourly, getMonthDays, getMonths, getLifetime } from './db'

// ── Config constants (not in DB) ──────────────────────────────────────────────

export const SYSTEM = {
  name: 'คุณกิ่งกาญจน์ 75/63',
  ratedPowerKw: 8,
  batteryCapacityKwh: 10,
  installDate: '2026-05-11',
  investmentTHB: 280000,
  serialNumber: 'LIBIPS08EEEAF618',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const MONTH_SHORT_TH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']
const MONTH_LONG_TH = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม']
// 'YYYY-MM' → Thai short label
const thMonth = (yyyymm: string) => MONTH_SHORT_TH[parseInt(yyyymm.slice(4)) - 1] ?? yyyymm

// ── Main assembler ────────────────────────────────────────────────────────────

export async function getAll() {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1

  const [live, today, monthDays, rawMonths, hourly, lifetime] = await Promise.all([getLiveSnapshot(), getToday(), getMonthDays(year, month), getMonths(12), getHourly(), getLifetime()])

  // ── Battery ────────────────────────────────────────────────────────────────
  const storedKwh = (SYSTEM.batteryCapacityKwh * live.batterySoc) / 100
  const battery = {
    soc: live.batterySoc,
    soh: live.batterySoh,
    powerKw: live.batteryPowerKw,
    voltage: live.batteryVoltage,
    current: live.batteryCurrent,
    cyclePeriod: live.cyclePeriod,
    status: live.batteryPowerKw < -0.05 ? 'charging' : live.batteryPowerKw > 0.05 ? 'discharging' : 'idle',
    storedKwh,
    backupHours: live.loadPowerKw > 0 ? storedKwh / live.loadPowerKw : 0,
  }

  // ── PV strings ────────────────────────────────────────────────────────────
  const pvStrings = [
    { name: 'แผง MPPT 1', power: live.pv1.power, voltage: live.pv1.voltage, current: live.pv1.current },
    { name: 'แผง MPPT 2', power: live.pv2.power, voltage: live.pv2.voltage, current: live.pv2.current },
  ]

  // ── System health (gridFrequency not in DB → use design nominal 50 Hz) ────
  const systemHealth = {
    gridVoltage: live.gridVoltage,
    gridFrequency: 50,
    inverterVoltage: live.gridVoltage,
    totalGenerationHours: live.totalGenerationTime,
    ratedPowerKw: SYSTEM.ratedPowerKw,
    loadFactorPct: (live.pvPowerKw / SYSTEM.ratedPowerKw) * 100,
    gridVoltageOk: live.gridVoltage >= 210 && live.gridVoltage <= 245,
    gridFrequencyOk: true,
  }

  // ── Today derived ─────────────────────────────────────────────────────────
  const selfUseToday = Math.max(0, today.consumed - today.gridImport)
  const rate = marginalRate(320)
  const day = {
    selfUse: selfUseToday,
    savedTHB: selfUseToday * rate,
    gridCostTHB: today.gridImport * rate,
    wouldHaveCostTHB: today.consumed * rate,
    selfSufficiency: today.consumed > 0 ? (selfUseToday / today.consumed) * 100 : 0,
  }

  // ── Month days ────────────────────────────────────────────────────────────
  const formattedMonthDays = monthDays.map((d) => {
    const selfUse = Math.max(0, d.consumed - d.gridImport)
    return {
      day: String(d.day),
      generated: d.generated,
      consumed: d.consumed,
      selfUse,
      gridImport: d.gridImport,
      saved: +(selfUse * rate).toFixed(1),
    }
  })

  // ── Monthly history ───────────────────────────────────────────────────────
  const months = rawMonths.map((m) => {
    const selfUse = Math.max(0, m.consumed - m.gridImport)
    const bill = calculateMonthlyBill(m.gridImport)
    const billFull = calculateMonthlyBill(m.consumed)
    return {
      month: thMonth(m.month),
      generated: Math.round(m.generated),
      consumed: Math.round(m.consumed),
      selfUse: Math.round(selfUse),
      gridImport: Math.round(m.gridImport),
      billWithSolar: bill.total,
      billWithoutSolar: billFull.total,
      saved: billFull.total - bill.total,
    }
  })

  // ── Month label ───────────────────────────────────────────────────────────
  const monthLabel = `${MONTH_LONG_TH[month - 1]} ${year + 543}`

  // ── Hourly ───────────────────────────────────────────────────────────────
  // Fill all 24 hours, zeroing out hours with no data
  const hourlyMap = new Map(hourly.map((h) => [h.hour, h]))
  const fullHourly = Array.from({ length: 24 }, (_, h) => {
    const d = hourlyMap.get(h) ?? { hour: h, pv: 0, load: 0, soc: 0 }
    return {
      hour: `${String(h).padStart(2, '0')}:00`,
      pv: d.pv,
      load: d.load,
      net: +(d.pv - d.load).toFixed(2),
    }
  })
  const hourlySoc = Array.from({ length: 24 }, (_, h) => {
    const d = hourlyMap.get(h)
    return { hour: `${String(h).padStart(2, '0')}:00`, soc: d?.soc ?? 0 }
  })

  // ── Energy distribution (from lifetime) ──────────────────────────────────
  const selfUsedLife = Math.round(lifetime.generated * 0.62)
  const toBatteryLife = Math.round(lifetime.generated * 0.26)
  const exportedLife = Math.max(0, Math.round(lifetime.generated - selfUsedLife - toBatteryLife))
  const energyDistribution = [
    { name: 'ใช้ในบ้านทันที', value: selfUsedLife, key: 'selfUse' },
    { name: 'เก็บเข้าแบตเตอรี่', value: toBatteryLife, key: 'battery' },
    { name: 'ขายคืน/ส่งออก', value: exportedLife, key: 'export' },
  ]

  // ── Payback ───────────────────────────────────────────────────────────────
  const totalSavedToDate = months.reduce((s, m) => s + m.saved, 0)
  const monthlyAvgSaving = months.length > 0 ? totalSavedToDate / months.length : 0
  const remaining = Math.max(0, SYSTEM.investmentTHB - totalSavedToDate)
  const monthsToPayback = monthlyAvgSaving > 0 ? remaining / monthlyAvgSaving : 0
  const payback = {
    monthlyAvgSaving,
    annualSaving: monthlyAvgSaving * 12,
    totalSavedToDate,
    remaining,
    monthsToPayback,
    yearsToPayback: monthsToPayback / 12,
    progressPct: (totalSavedToDate / SYSTEM.investmentTHB) * 100,
  }

  return {
    system: SYSTEM,
    live,
    battery,
    pvStrings,
    systemHealth,
    today: { ...today, generationHours: 0 }, // generationHours not in DB
    day,
    monthDays: formattedMonthDays,
    monthLabel,
    months,
    hourly: fullHourly,
    hourlySoc,
    energyDistribution,
    lifetime,
    payback,
  }
}

export type SolarData = Awaited<ReturnType<typeof getAll>>
