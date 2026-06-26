import { calculateMonthlyBill, marginalRate, MONTH_SHORT_TH } from './electricity'
import { getLiveSnapshot, getToday, getHourly, get5Min, getMonthDays, getMonths, getLifetime, getBills, getBatteryCharge, getPvPeak } from './db'

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

const MONTH_LONG_TH = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม']
// 'YYYY-MM' → Thai short label
const thMonth = (yyyymm: string) => MONTH_SHORT_TH[parseInt(yyyymm.slice(4)) - 1] ?? yyyymm

// ── Main assembler ────────────────────────────────────────────────────────────

export async function getAll(date?: Date) {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1

  const [live, today, monthDays, rawMonths, hourly, fiveMinRaw, lifetime, bills, histBatteryCharge, pvPeak] = await Promise.all([
    getLiveSnapshot(),
    getToday(date),
    getMonthDays(year, month),
    getMonths(12),
    getHourly(date),
    get5Min(date),
    getLifetime(),
    getBills(36),
    getBatteryCharge(12),
    getPvPeak(),
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
    { name: 'แผง MPPT 1', power: live.pv1.power, voltage: live.pv1.voltage, current: live.pv1.current, installed: true, peakKw: pvPeak.pv1 },
    { name: 'แผง MPPT 2', power: live.pv2.power, voltage: live.pv2.voltage, current: live.pv2.current, installed: true, peakKw: pvPeak.pv2 },
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
  const ZERO_HOUR = { hour: 0, pv: 0, load: 0, soc: 0, batteryPower: 0, gridPower: 0 }
  const fullHourly = Array.from({ length: 24 }, (_, h) => {
    const d = hourlyMap.get(h) ?? { ...ZERO_HOUR, hour: h }
    return {
      hour: `${String(h).padStart(2, '0')}:00`,
      pv: d.pv,
      load: d.load,
      net: +(d.pv - d.load).toFixed(2),
      batt: d.batteryPower, // + = discharging, - = charging
      grid: d.gridPower, // - = importing
    }
  })
  const hourlySoc = Array.from({ length: 24 }, (_, h) => {
    const d = hourlyMap.get(h)
    return { hour: `${String(h).padStart(2, '0')}:00`, soc: d?.soc ?? 0 }
  })

  // ── 5-minute resolution — ใช้ recorded_at จริง ไม่ fill slot ───────────────
  const full5Min = fiveMinRaw.map((s) => ({
    minuteOfDay: s.minuteOfDay,
    time: `${String(Math.floor(s.minuteOfDay / 60)).padStart(2, '0')}:${String(s.minuteOfDay % 60).padStart(2, '0')}`,
    pv: s.pv,
    pv1: s.pv1,
    pv2: s.pv2,
    load: s.load,
    net: +(s.pv - s.load).toFixed(2),
    batt: s.batteryPower,
    grid: s.gridPower,
  }))

  // ── Energy distribution — ratio derived from actual monthly DB data ───────
  const histGen = rawMonths.reduce((s, m) => s + m.generated, 0)
  const histSolarUse = rawMonths.reduce((s, m) => s + Math.max(0, m.consumed - m.gridImport), 0)
  const histBatteryUse = Math.min(histBatteryCharge, histGen)
  const histHomeUse = Math.max(0, histSolarUse - histBatteryUse)
  const homeUseRatio = histGen > 0 ? histHomeUse / histGen : 0
  const batteryUseRatio = histGen > 0 ? histBatteryUse / histGen : 0
  const selfUsedLife = Math.round(lifetime.generated * homeUseRatio)
  const batteryChargedLife = Math.round(lifetime.generated * batteryUseRatio)
  const discardedLife = Math.max(0, lifetime.generated - selfUsedLife - batteryChargedLife)
  const energyDistribution = [
    { name: 'ใช้เองในบ้าน', value: selfUsedLife, key: 'selfUse' },
    { name: 'ชาร์จเข้าแบตเตอรี่', value: batteryChargedLife, key: 'batteryCharge' },
    { name: 'เหลือทิ้ง', value: discardedLife, key: 'clipped' },
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

  // ── Month picker — เดือนที่มีข้อมูลจริงใน DB ────────────────────────────────
  const monthPicker = rawMonths.map((m) => {
    const y = parseInt(m.month.slice(0, 4))
    const mo = parseInt(m.month.slice(5))
    return { value: m.month.replace('-', ''), label: `${MONTH_SHORT_TH[mo - 1]} ${String(y + 543).slice(-2)}` }
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
    monthPicker,
    months,
    hourly: fullHourly,
    hourlySoc,
    fiveMin: full5Min,
    energyDistribution,
    lifetime,
    payback,
    bills: billsEnhanced,
  }
}

export type SolarData = Awaited<ReturnType<typeof getAll>>

/** ข้อมูลรายวัน + สรุปรวมของเดือนที่กำหนด (สำหรับ month picker) */
export async function getMonthLoad(year: number, month: number) {
  const monthDays = await getMonthDays(year, month)

  const daysInMonth = new Date(year, month, 0).getDate()
  const dayMap = new Map(monthDays.map((d) => [d.day, d]))
  const monthlyGridKwh = monthDays.reduce((s, d) => s + d.gridImport, 0)
  const rate = marginalRate(monthlyGridKwh || 320)

  const days = Array.from({ length: daysInMonth }, (_, i) => {
    const d = dayMap.get(i + 1) ?? { day: i + 1, generated: 0, consumed: 0, gridImport: 0 }
    const selfUse = Math.max(0, d.consumed - d.gridImport)
    return { day: String(d.day), generated: d.generated, consumed: d.consumed, selfUse, gridImport: d.gridImport, saved: +(selfUse * rate).toFixed(1) }
  })

  const raw = days.reduce((a, d) => ({ generated: a.generated + d.generated, consumed: a.consumed + d.consumed, gridImport: a.gridImport + d.gridImport, selfUse: a.selfUse + d.selfUse }), {
    generated: 0,
    consumed: 0,
    gridImport: 0,
    selfUse: 0,
  })
  const billActual = calculateMonthlyBill(raw.gridImport)
  const billNoSolar = calculateMonthlyBill(raw.consumed)

  return {
    days,
    label: `${MONTH_LONG_TH[month - 1]} ${year + 543}`,
    labelShort: `${MONTH_SHORT_TH[month - 1]} ${String(year + 543).slice(-2)}`,
    totals: {
      ...raw,
      savedTHB: Math.max(0, billNoSolar.total - billActual.total),
      gridCostTHB: billActual.total,
      wouldHaveCostTHB: billNoSolar.total,
      selfSufficiency: raw.consumed > 0 ? (raw.selfUse / raw.consumed) * 100 : 0,
    },
  }
}

export type MonthLoad = Awaited<ReturnType<typeof getMonthLoad>>
