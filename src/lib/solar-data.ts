import { calculateMonthlyBill, marginalRate } from './electricity'
import { getLiveSnapshot, getToday, getHourly, getMonthDays, getMonths, getLifetime, getBills } from './db'

// ── Config constants (not in DB) ──────────────────────────────────────────────

export const SYSTEM = {
  name: 'บ้าน 75/63',
  ratedPowerKw: 8,
  batteryCapacityKwh: 10,
  installDate: '2026-05-11',
  investmentTHB: 359000,
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

  const [live, today, monthDays, rawMonths, hourly, lifetime, bills] = await Promise.all([
    getLiveSnapshot(),
    getToday(),
    getMonthDays(year, month),
    getMonths(12),
    getHourly(),
    getLifetime(),
    getBills(36),
  ])

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

  // gridFrequency not in DB → nominal 50 Hz (Thailand standard)
  const ratedKw = live.powerRating || SYSTEM.ratedPowerKw
  const systemHealth = {
    gridVoltage: live.gridVoltage,
    gridFrequency: 50,
    inverterVoltage: live.gridVoltage,
    totalGenerationHours: live.totalGenerationTime,
    ratedPowerKw: ratedKw,
    loadFactorPct: ratedKw > 0 ? (live.pvPowerKw / ratedKw) * 100 : 0,
    gridVoltageOk: live.gridVoltage >= 210 && live.gridVoltage <= 245,
    gridFrequencyOk: true,
  }

  // ── Today derived ─────────────────────────────────────────────────────────
  const selfUseToday = Math.max(0, today.consumed - today.gridImport)
  const monthlyGridKwh = monthDays.reduce((s, d) => s + d.gridImport, 0)
  // diff bill ตาม tier จริง แทน flat rate — service charge หักล้างกันในทุก diff
  const billActual = calculateMonthlyBill(monthlyGridKwh)
  const billNoSolarToday = calculateMonthlyBill(monthlyGridKwh + selfUseToday)
  const billNoElecToday = calculateMonthlyBill(Math.max(0, monthlyGridKwh - today.gridImport))
  const day = {
    selfUse: selfUseToday,
    savedTHB: billNoSolarToday.total - billActual.total,
    gridCostTHB: billActual.total - billNoElecToday.total,
    wouldHaveCostTHB: billNoSolarToday.total - billNoElecToday.total,
    selfSufficiency: today.consumed > 0 ? (selfUseToday / today.consumed) * 100 : 0,
  }
  // rate ยังใช้สำหรับ chart รายวัน (marginal เพียงพอสำหรับ relative comparison)
  const rate = marginalRate(monthlyGridKwh || 320)

  // ── Month days — fill all days of month with zeros for missing dates ────────
  const daysInMonth = new Date(year, month, 0).getDate()
  const dayMap = new Map(monthDays.map((d) => [d.day, d]))
  const formattedMonthDays = Array.from({ length: daysInMonth }, (_, i) => {
    const d = dayMap.get(i + 1) ?? { day: i + 1, generated: 0, consumed: 0, gridImport: 0 }
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
  // ponytail: build paid-lookup once, reused by months + billsEnhanced
  const billPaidMap = new Map(bills.map((b) => [b.month, b.paid]))
  const months = rawMonths.map((m) => {
    const selfUse = Math.max(0, m.consumed - m.gridImport)
    const billWithoutSolar = calculateMonthlyBill(m.consumed).total
    // prefer actual MEA paid; fall back to calculated estimate
    const billWithSolar = billPaidMap.get(m.month.replace('-', '')) ?? calculateMonthlyBill(m.gridImport).total
    return {
      month: thMonth(m.month),
      generated: Math.round(m.generated),
      consumed: Math.round(m.consumed),
      selfUse: Math.round(selfUse),
      gridImport: Math.round(m.gridImport),
      billWithSolar,
      billWithoutSolar,
      saved: billWithoutSolar - billWithSolar,
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

  // ── Energy distribution — ratio derived from actual monthly DB data ───────
  const histGen = rawMonths.reduce((s, m) => s + m.generated, 0)
  const histSelfUse = rawMonths.reduce((s, m) => s + Math.max(0, m.consumed - m.gridImport), 0)
  const selfUseRatio = histGen > 0 ? histSelfUse / histGen : 0
  const selfUsedLife = Math.round(lifetime.generated * selfUseRatio)
  const exportedLife = Math.max(0, lifetime.generated - selfUsedLife)
  const energyDistribution = [
    { name: 'ใช้ในบ้านทันที', value: selfUsedLife, key: 'selfUse' },
    { name: 'ส่งออก/เหลือเกิน', value: exportedLife, key: 'export' },
  ]

  // ── Payback — ใช้ solar_record (inverter data) เพราะ mea_electric ไม่มี unitUsedSolar ──
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

  // ── Bills — "ถ้าไม่มีโซลาร์" = consumed จาก inverter (fallback MEA) ─────────
  const rawMonthConsumedMap = new Map(rawMonths.map((m) => [m.month.replace('-', ''), m.consumed]))
  const billsEnhanced = bills.map((b) => {
    const totalConsumed = rawMonthConsumedMap.get(b.month) ?? b.kwh + b.unitUsedSolar
    const withoutSolar = calculateMonthlyBill(totalConsumed).total
    return { ...b, consumed: totalConsumed, withoutSolar, savedTHB: Math.max(0, withoutSolar - b.paid) }
  })

  return {
    system: { ...SYSTEM, ratedPowerKw: live.powerRating || SYSTEM.ratedPowerKw },
    live,
    battery,
    pvStrings,
    systemHealth,
    today: { ...today, generationHours: hourly.filter((h) => h.pv > 0).length },
    day,
    monthDays: formattedMonthDays,
    monthLabel,
    months,
    hourly: fullHourly,
    hourlySoc,
    energyDistribution,
    lifetime,
    payback,
    bills: billsEnhanced,
  }
}

export type SolarData = Awaited<ReturnType<typeof getAll>>
