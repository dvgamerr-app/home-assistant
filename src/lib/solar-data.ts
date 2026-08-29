import { formatISODate, getBangkokISODate } from './date'
import { cacheData } from './data-cache'
import { logger } from './logger'
import { toFiveMinChartPoint } from './solar-fivemin'
import { calculateMonthlyBill, marginalRate, MONTH_LONG_TH, MONTH_SHORT_TH } from './electricity'
import {
  getBills,
  get5Min,
  getHourly,
  getLifetime,
  getLiveSnapshot,
  getMonthDays,
  getMonths,
  getPvPeak,
  getRecentDailyTotals,
  getToday,
  getWaterUsage,
  type DayPoint,
  type LiveSnapshot,
  type MonthPoint,
} from './db'

export const SYSTEM = {
  name: 'บ้าน 75/63',
  ratedPowerKw: 8,
  batteryCapacityKwh: 10,
  batteryConnectedMinVoltage: 20,
  installDate: '2026-05-11',
  investmentTHB: 359000,
  serialNumber: 'LIBIPS08EEEAF618',
}

const thMonth = (yyyymm: string) => MONTH_SHORT_TH[parseInt(yyyymm.slice(4)) - 1] ?? yyyymm
const round = (value: number, digits = 1) => Number(value.toFixed(digits))
const clampZero = (value: number) => Math.max(0, value)
const pct = (part: number, total: number, digits = 0) => (total > 0 ? round((part / total) * 100, digits) : 0)

const EMPTY_LIVE: LiveSnapshot = {
  pvPowerKw: 0,
  loadPowerKw: 0,
  batteryPowerKw: 0,
  batterySoc: 0,
  batterySoh: null,
  gridPowerKw: 0,
  batteryVoltage: 0,
  batteryCurrent: 0,
  cyclePeriod: 0,
  pv1: { power: 0, voltage: 0, current: 0 },
  pv2: { power: 0, voltage: 0, current: 0 },
  gridVoltage: 0,
  gridFrequencyHz: null,
  totalGenerationTime: 0,
  powerRating: 0,
  offGridPowerKw: 0,
  isOnline: false,
  lastUpdate: new Date(0).toISOString(),
  batteryStatus: null,
  firmwareVersion: null,
  serialNumber: null,
  activeAlarms: [],
}

export type SolarDataScope = 'all' | 'overview' | 'load' | 'solar' | 'bill'

/**
 * แกะผลจาก Promise.allSettled — slot ที่พังจะกลายเป็น null แล้วไปใช้ fallback
 * พร้อม log ไว้ ไม่ให้ query ที่ล้มหายไปเงียบๆ (db.ts ไม่มี logging ของตัวเอง)
 */
function settled<T>(result: PromiseSettledResult<T | null>, slot: string): T | null {
  if (result.status === 'fulfilled') return result.value
  logger.error({ err: result.reason, slot }, 'solar data query failed, falling back to empty values')
  return null
}

const CACHE = {
  live: 5_000,
  currentDay: 30_000,
  currentAggregate: 60_000,
  historical: 6 * 60 * 60_000,
  slowMoving: 5 * 60_000,
} as const

/**
 * TTL ของข้อมูลรายวัน — วันนี้เปลี่ยนตลอด, วันย้อนหลังนิ่งแล้ว
 * export ไว้เพราะ `/api/solar/five-min` ใช้ cache key เดียวกัน ถ้าตั้ง TTL คนละค่า
 * ใครเรียกก่อนจะเป็นคนกำหนด TTL ให้อีกฝ่ายไปด้วย (กราฟวันนี้อาจถูก cache 6 ชม.)
 */
export const dayCacheTtl = (iso: string) => (iso === getBangkokISODate() ? CACHE.currentDay : CACHE.historical)
export const fiveMinCacheKey = (iso: string) => `solar:five-min:${iso}`

function changeFrom(current: number, previous: number) {
  const diff = current - previous
  return {
    diff,
    pct: previous > 0 ? round((diff / previous) * 100, 0) : null,
  }
}

function integratePowerSeries<T extends { minuteOfDay: number }>(points: T[], projector: (point: T) => number) {
  if (points.length === 0) return 0

  let total = 0
  for (let i = 0; i < points.length; i++) {
    const current = points[i]
    const next = points[i + 1]
    const deltaMinutes = next ? Math.min(Math.max(next.minuteOfDay - current.minuteOfDay, 0), 15) : 5
    total += projector(current) * (deltaMinutes / 60)
  }

  return round(total, 2)
}

function average(values: number[], digits = 1) {
  if (values.length === 0) return 0
  return round(values.reduce((sum, value) => sum + value, 0) / values.length, digits)
}

/** เติมวันที่ขาดให้ครบทั้งเดือน + คิดมูลค่าประหยัดต่อวันด้วย marginal rate ของเดือนนั้น */
function formatMonthDays(monthDays: DayPoint[], year: number, month: number) {
  const daysInMonth = new Date(year, month, 0).getDate()
  const dayMap = new Map(monthDays.map((dayPoint) => [dayPoint.day, dayPoint]))
  const monthlyGridKwh = monthDays.reduce((sum, dayPoint) => sum + dayPoint.gridImport, 0)
  const rate = marginalRate(monthlyGridKwh || 320)

  return Array.from({ length: daysInMonth }, (_, index) => {
    const dayPoint = dayMap.get(index + 1) ?? {
      day: index + 1,
      generated: 0,
      consumed: 0,
      gridImport: 0,
      hasGenerationData: false,
      hasUsageData: false,
    }
    const selfUse = clampZero(dayPoint.consumed - dayPoint.gridImport)

    return {
      day: String(dayPoint.day),
      generated: dayPoint.generated,
      consumed: dayPoint.consumed,
      selfUse,
      gridImport: dayPoint.gridImport,
      saved: +(selfUse * rate).toFixed(1),
      hasGenerationData: dayPoint.hasGenerationData,
      hasUsageData: dayPoint.hasUsageData,
    }
  })
}

function summarizeMonth(monthPoint: MonthPoint, selfUseOverride?: number) {
  const year = parseInt(monthPoint.month.slice(0, 4))
  const month = parseInt(monthPoint.month.slice(5))
  const selfUse = selfUseOverride ?? clampZero(monthPoint.consumed - monthPoint.gridImport)
  const billActual = calculateMonthlyBill(monthPoint.gridImport)
  const billNoSolar = calculateMonthlyBill(monthPoint.consumed)

  return {
    key: monthPoint.month,
    label: `${MONTH_LONG_TH[month - 1]} ${year + 543}`,
    labelShort: `${MONTH_SHORT_TH[month - 1]} ${String(year + 543).slice(-2)}`,
    totals: {
      generated: monthPoint.generated,
      consumed: monthPoint.consumed,
      gridImport: monthPoint.gridImport,
      selfUse,
      savedTHB: Math.max(0, billNoSolar.total - billActual.total),
      gridCostTHB: billActual.total,
      wouldHaveCostTHB: billNoSolar.total,
      selfSufficiency: monthPoint.consumed > 0 ? (selfUse / monthPoint.consumed) * 100 : 0,
      hasGenerationData: monthPoint.hasGenerationData,
      hasUsageData: monthPoint.hasUsageData,
    },
  }
}

export async function getAll(date?: Date, scope: SolarDataScope = 'all') {
  const selectedDate = date ?? new Date()
  const year = selectedDate.getFullYear()
  const month = selectedDate.getMonth() + 1
  const selectedISO = formatISODate(selectedDate)
  const todayISO = getBangkokISODate()

  const needsLive = scope === 'all' || scope === 'overview' || scope === 'solar'
  const needsToday = scope === 'all' || scope === 'overview' || scope === 'load' || scope === 'solar'
  const needsMonthDays = scope === 'all' || scope === 'overview' || scope === 'load'
  const needsHourly = scope === 'all' || scope === 'overview' || scope === 'load'
  const needsFiveMin = scope === 'all' || scope === 'load' || scope === 'solar'
  const needsSolarHistory = scope === 'all' || scope === 'solar'
  const needsDayComparison = scope === 'all' || scope === 'load' || scope === 'solar'
  const needsBills = scope === 'all' || scope === 'overview' || scope === 'bill'
  const selectedMonth = selectedISO.slice(0, 7)
  const currentMonth = todayISO.slice(0, 7)
  const dayTtl = dayCacheTtl(selectedISO)
  const monthTtl = selectedMonth === currentMonth ? CACHE.currentAggregate : CACHE.historical

  // allSettled ไม่ใช่ all — slot ทั้ง 10 อันเป็นอิสระต่อกัน และมี fallback รออยู่แล้วข้างล่าง
  // ถ้าใช้ Promise.all แล้ว query เดียวพลาด (เช่น bills) หน้าเว็บทั้งหน้าจะ 500
  // ทั้งที่ควรแสดงส่วนที่เหลือได้ปกติ
  const [liveResult, todayResult, monthDaysResult, monthsResult, hourlyResult, fiveMinResult, lifetimeResult, billsResult, pvPeakResult, recentDailyResult] = await Promise.allSettled([
    needsLive ? cacheData('solar:live', CACHE.live, getLiveSnapshot) : Promise.resolve(null),
    needsToday ? cacheData(`solar:today:${selectedISO}`, dayTtl, () => getToday(selectedDate)) : Promise.resolve(null),
    needsMonthDays ? cacheData(`solar:month-days:${selectedMonth}`, monthTtl, () => getMonthDays(year, month)) : Promise.resolve(null),
    cacheData('solar:months:12', CACHE.currentAggregate, () => getMonths(12)),
    needsHourly ? cacheData(`solar:hourly:${selectedISO}`, dayTtl, () => getHourly(selectedDate)) : Promise.resolve(null),
    needsFiveMin ? cacheData(fiveMinCacheKey(selectedISO), dayTtl, () => get5Min(selectedDate)) : Promise.resolve(null),
    needsSolarHistory ? cacheData('solar:lifetime', CACHE.slowMoving, getLifetime) : Promise.resolve(null),
    needsBills ? cacheData('utility:bills:36', CACHE.slowMoving, () => getBills(36)) : Promise.resolve(null),
    needsSolarHistory ? cacheData('solar:pv-peak', CACHE.slowMoving, getPvPeak) : Promise.resolve(null),
    needsDayComparison ? cacheData(`solar:recent-daily:${selectedISO}:8`, dayTtl, () => getRecentDailyTotals(selectedDate, 8)) : Promise.resolve(null),
  ])

  const live = settled(liveResult, 'live') ?? EMPTY_LIVE
  const today = settled(todayResult, 'today') ?? { generated: 0, consumed: 0, gridImport: 0, hasGenerationData: false, hasUsageData: false }
  const monthDays = settled(monthDaysResult, 'monthDays') ?? []
  const rawMonths = settled(monthsResult, 'months') ?? []
  const hourly = settled(hourlyResult, 'hourly') ?? []
  const fiveMinRaw = settled(fiveMinResult, 'fiveMin') ?? []
  const lifetime = settled(lifetimeResult, 'lifetime') ?? { generated: 0, gridImport: 0, generationTime: 0, co2ReductionKg: 0, hasGenerationData: false }
  const bills = settled(billsResult, 'bills') ?? []
  const pvPeak = settled(pvPeakResult, 'pvPeak') ?? { pv1: 0, pv2: 0 }
  const recentDailyRows = settled(recentDailyResult, 'recentDaily') ?? []

  const pvStrings = [
    { name: 'แผง MPPT 1', power: live.pv1.power, voltage: live.pv1.voltage, current: live.pv1.current, installed: true, peakKw: pvPeak.pv1 },
    { name: 'แผง MPPT 2', power: live.pv2.power, voltage: live.pv2.voltage, current: live.pv2.current, installed: true, peakKw: pvPeak.pv2 },
  ]

  const selfUseToday = clampZero(today.consumed - today.gridImport)
  const monthlyGridKwh = monthDays.reduce((sum, dayPoint) => sum + dayPoint.gridImport, 0)
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
  const formattedMonthDays = formatMonthDays(monthDays, year, month)

  const billPaidMap = new Map(bills.map((bill) => [bill.month, bill.paid]))
  const monthSummaries = rawMonths.map(summarizeMonth)
  const months = rawMonths.map((monthPoint) => {
    const selfUse = clampZero(monthPoint.consumed - monthPoint.gridImport)
    const billWithoutSolar = calculateMonthlyBill(monthPoint.consumed).total
    const billWithSolar = billPaidMap.get(monthPoint.month.replace('-', '')) ?? calculateMonthlyBill(monthPoint.gridImport).total
    const solarSurplus = clampZero(monthPoint.generated - selfUse)

    return {
      month: thMonth(monthPoint.month),
      generated: Math.round(monthPoint.generated),
      consumed: Math.round(monthPoint.consumed),
      selfUse: Math.round(selfUse),
      gridImport: Math.round(monthPoint.gridImport),
      selfSufficiencyPct: pct(selfUse, monthPoint.consumed),
      gridDependencyPct: pct(monthPoint.gridImport, monthPoint.consumed),
      solarSurplus,
      solarSurplusPct: pct(solarSurplus, monthPoint.generated),
      billWithSolar,
      billWithoutSolar,
      saved: billWithoutSolar - billWithSolar,
      hasGenerationData: monthPoint.hasGenerationData,
      hasUsageData: monthPoint.hasUsageData,
    }
  })

  const monthLabel = `${MONTH_LONG_TH[month - 1]} ${year + 543}`

  const full5Min = fiveMinRaw.map((sample) => ({ ...toFiveMinChartPoint(sample), soc: sample.soc }))

  const batteryChargeKwh = integratePowerSeries(fiveMinRaw, (sample) => Math.max(-sample.batteryPower, 0))
  const batteryDischargeKwh = integratePowerSeries(fiveMinRaw, (sample) => Math.max(sample.batteryPower, 0))
  const peakPvKw = Math.max(...fiveMinRaw.map((sample) => sample.pv), 0)
  const peakLoadKw = Math.max(...fiveMinRaw.map((sample) => sample.load), 0)
  const peakBatteryDischargeKw = Math.max(...fiveMinRaw.map((sample) => sample.batteryPower), 0)
  const solarSurplusKwh = clampZero(today.generated - selfUseToday - batteryChargeKwh)

  const dayFlow = {
    date: selectedISO,
    generated: today.generated,
    consumed: today.consumed,
    gridImport: today.gridImport,
    selfPowered: selfUseToday,
    selfSufficiencyPct: pct(selfUseToday, today.consumed),
    gridDependencyPct: pct(today.gridImport, today.consumed),
    batteryChargeKwh,
    batteryDischargeKwh,
    solarSurplusKwh,
    solarSurplusPct: pct(solarSurplusKwh, today.generated),
    peakPvKw,
    peakLoadKw,
    peakBatteryDischargeKw,
    hasGenerationData: today.hasGenerationData,
    hasUsageData: today.hasUsageData,
    hasPowerSeries: fiveMinRaw.length > 0,
  }

  const recentDailyMap = new Map(recentDailyRows.map((row) => [row.date, row]))
  const recentDaily = Array.from({ length: 8 }, (_, index) => {
    const dateValue = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate() - (7 - index))
    const iso = formatISODate(dateValue)
    const row = recentDailyMap.get(iso) ?? {
      date: iso,
      generated: 0,
      consumed: 0,
      gridImport: 0,
      hasGenerationData: false,
      hasUsageData: false,
    }
    const selfPowered = clampZero(row.consumed - row.gridImport)

    return {
      date: iso,
      generated: row.generated,
      consumed: row.consumed,
      gridImport: row.gridImport,
      selfPowered,
      selfSufficiencyPct: pct(selfPowered, row.consumed),
      gridDependencyPct: pct(row.gridImport, row.consumed),
      hasGenerationData: row.hasGenerationData,
      hasUsageData: row.hasUsageData,
    }
  })

  const previousDay = recentDaily.at(-2)
  const baselineDays = recentDaily.slice(0, -1)
  const generationBaselineDays = baselineDays.filter((entry) => entry.hasGenerationData)
  const usageBaselineDays = baselineDays.filter((entry) => entry.hasUsageData)
  const trailing7Avg = {
    generated: average(
      generationBaselineDays.map((entry) => entry.generated),
      1,
    ),
    consumed: average(
      usageBaselineDays.map((entry) => entry.consumed),
      1,
    ),
    gridImport: average(
      usageBaselineDays.map((entry) => entry.gridImport),
      1,
    ),
    selfPowered: average(
      usageBaselineDays.map((entry) => entry.selfPowered),
      1,
    ),
    selfSufficiencyPct: average(
      usageBaselineDays.map((entry) => entry.selfSufficiencyPct),
      0,
    ),
    gridDependencyPct: average(
      usageBaselineDays.map((entry) => entry.gridDependencyPct),
      0,
    ),
    generationDays: generationBaselineDays.length,
    usageDays: usageBaselineDays.length,
  }

  const dayComparison = {
    previousDay,
    trailing7Avg,
    deltaFromPrevious: previousDay && {
      generated: dayFlow.hasGenerationData && previousDay.hasGenerationData ? changeFrom(dayFlow.generated, previousDay.generated) : undefined,
      gridImport: dayFlow.hasUsageData && previousDay.hasUsageData ? changeFrom(dayFlow.gridImport, previousDay.gridImport) : undefined,
      selfSufficiencyPct: dayFlow.hasUsageData && previousDay.hasUsageData ? changeFrom(dayFlow.selfSufficiencyPct, previousDay.selfSufficiencyPct) : undefined,
    },
  }

  const totalSavedToDate = months.reduce((sum, monthPoint) => sum + monthPoint.saved, 0)
  // months[0] is the current (in-progress) month; average from last full month onward so a partial month doesn't skew the payback rate
  const completedMonths = months.slice(1)
  const monthlyAvgSaving = completedMonths.length > 0 ? completedMonths.reduce((sum, monthPoint) => sum + monthPoint.saved, 0) / completedMonths.length : 0
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

  const rawMonthConsumedMap = new Map(rawMonths.map((monthPoint) => [monthPoint.month.replace('-', ''), monthPoint.consumed]))
  const billsEnhanced = bills.map((bill) => {
    const totalConsumed = rawMonthConsumedMap.get(bill.month) ?? bill.kwh + bill.unitUsedSolar
    const withoutSolar = calculateMonthlyBill(totalConsumed).total
    return { ...bill, consumed: totalConsumed, withoutSolar, savedTHB: Math.max(0, withoutSolar - bill.paid) }
  })

  const latestMonth = months[0]
  const gridOverview = {
    monthLabel: latestMonth?.month ?? '-',
    selfSufficiencyPct: latestMonth?.selfSufficiencyPct ?? 0,
    gridDependencyPct: latestMonth?.gridDependencyPct ?? 0,
    solarSurplusKwh: latestMonth?.solarSurplus ?? 0,
    solarSurplusPct: latestMonth?.solarSurplusPct ?? 0,
  }

  const monthPicker = rawMonths.map((monthPoint) => {
    const y = parseInt(monthPoint.month.slice(0, 4))
    const mo = parseInt(monthPoint.month.slice(5))
    return { value: monthPoint.month.replace('-', ''), label: `${MONTH_SHORT_TH[mo - 1]} ${String(y + 543).slice(-2)}` }
  })

  return {
    system: { ...SYSTEM, ratedPowerKw: live.powerRating || SYSTEM.ratedPowerKw },
    live,
    pvStrings,
    today: { ...today, generationHours: hourly.filter((hourPoint) => hourPoint.pv > 0).length },
    day,
    dayFlow,
    dayComparison,
    monthDays: formattedMonthDays,
    monthLabel,
    monthPicker,
    monthSummaries,
    months,
    gridOverview,
    fiveMin: full5Min,
    lifetime,
    payback,
    bills: billsEnhanced,
  }
}

export type SolarData = Awaited<ReturnType<typeof getAll>>

export const getOverviewData = () => getAll(undefined, 'overview')
export const getLoadPageData = () => getAll(undefined, 'load')
export const getSolarPageData = (date?: Date) => getAll(date, 'solar')
export const getBillPageData = () => getAll(undefined, 'bill')

export async function getMonthLoad(year: number, month: number) {
  const monthKey = `${year}-${String(month).padStart(2, '0')}`
  const currentMonth = getBangkokISODate().slice(0, 7)
  const ttl = monthKey === currentMonth ? CACHE.currentAggregate : CACHE.historical
  const monthDays = await cacheData(`solar:month-days:${monthKey}`, ttl, () => getMonthDays(year, month))
  const days = formatMonthDays(monthDays, year, month)

  const raw = days.reduce(
    (acc, dayPoint) => ({
      generated: acc.generated + dayPoint.generated,
      consumed: acc.consumed + dayPoint.consumed,
      gridImport: acc.gridImport + dayPoint.gridImport,
      selfUse: acc.selfUse + dayPoint.selfUse,
    }),
    {
      generated: 0,
      consumed: 0,
      gridImport: 0,
      selfUse: 0,
    },
  )
  const summary = summarizeMonth(
    {
      month: monthKey,
      generated: raw.generated,
      consumed: raw.consumed,
      gridImport: raw.gridImport,
      hasGenerationData: monthDays.some((dayPoint) => dayPoint.hasGenerationData),
      hasUsageData: monthDays.some((dayPoint) => dayPoint.hasUsageData),
    },
    raw.selfUse,
  )

  return {
    days,
    ...summary,
  }
}

export type MonthLoad = Awaited<ReturnType<typeof getMonthLoad>>
export type MonthLoadSummary = Omit<MonthLoad, 'days'>

/** ข้อมูลหน้าใช้น้ำ แยกจาก getAll() เพื่อไม่ให้หน้าพลังงานต้อง query ตารางน้ำโดยไม่จำเป็น */
export async function getWaterUsageData(nMonths = 24) {
  const source = await cacheData(`utility:water:${nMonths}`, CACHE.slowMoving, () => getWaterUsage(nMonths))
  const months = source.map((row) => ({
    ...row,
    label: `${MONTH_SHORT_TH[row.month - 1]} ${row.year + 543}`,
    unitPrice: row.consumption > 0 ? row.billedAmount / row.consumption : 0,
  }))
  const latest = months[0]
  const previous = months[1]

  return {
    months,
    latest,
    usageChangeFromPrevious: latest && previous ? latest.consumption - previous.consumption : null,
    amountChangeFromPrevious: latest && previous ? latest.paidAmount - previous.paidAmount : null,
    averageConsumption: average(
      months.map((row) => row.consumption),
      1,
    ),
    totalPaid: round(
      months.reduce((sum, row) => sum + row.paidAmount, 0),
      2,
    ),
  }
}

export type WaterUsageData = Awaited<ReturnType<typeof getWaterUsageData>>
