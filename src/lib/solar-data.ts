import { formatBangkokDateTime, formatISODate, getBangkokISODate } from './date'
import { calculateMonthlyBill, marginalRate, MONTH_SHORT_TH } from './electricity'
import { getBatteryCharge, getBills, get5Min, getHourly, getLifetime, getLiveSnapshot, getMonthDays, getMonths, getPvPeak, getRecentDailyTotals, getToday } from './db'

export const SYSTEM = {
  name: 'บ้าน 75/63',
  ratedPowerKw: 8,
  batteryCapacityKwh: 10,
  installDate: '2026-05-11',
  investmentTHB: 359000,
  serialNumber: 'LIBIPS08EEEAF618',
}

const MONTH_LONG_TH = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม']
const thMonth = (yyyymm: string) => MONTH_SHORT_TH[parseInt(yyyymm.slice(4)) - 1] ?? yyyymm
const round = (value: number, digits = 1) => Number(value.toFixed(digits))
const clampZero = (value: number) => Math.max(0, value)
const pct = (part: number, total: number, digits = 0) => (total > 0 ? round((part / total) * 100, digits) : 0)

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

export async function getAll(date?: Date) {
  const selectedDate = date ?? new Date()
  const year = selectedDate.getFullYear()
  const month = selectedDate.getMonth() + 1
  const selectedISO = formatISODate(selectedDate)
  const todayISO = getBangkokISODate()
  const isToday = selectedISO === todayISO

  const [live, today, monthDays, rawMonths, hourly, fiveMinRaw, lifetime, bills, histBatteryCharge, pvPeak, recentDailyRows] = await Promise.all([
    getLiveSnapshot(),
    getToday(selectedDate),
    getMonthDays(year, month),
    getMonths(12),
    getHourly(selectedDate),
    get5Min(selectedDate),
    getLifetime(),
    getBills(36),
    getBatteryCharge(12),
    getPvPeak(),
    getRecentDailyTotals(selectedDate, 8),
  ])

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

  const pvStrings = [
    { name: 'แผง MPPT 1', power: live.pv1.power, voltage: live.pv1.voltage, current: live.pv1.current, installed: true, peakKw: pvPeak.pv1 },
    { name: 'แผง MPPT 2', power: live.pv2.power, voltage: live.pv2.voltage, current: live.pv2.current, installed: true, peakKw: pvPeak.pv2 },
  ]

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
  const rate = marginalRate(monthlyGridKwh || 320)

  const daysInMonth = new Date(year, month, 0).getDate()
  const dayMap = new Map(monthDays.map((dayPoint) => [dayPoint.day, dayPoint]))
  const formattedMonthDays = Array.from({ length: daysInMonth }, (_, index) => {
    const dayPoint = dayMap.get(index + 1) ?? { day: index + 1, generated: 0, consumed: 0, gridImport: 0 }
    const selfUse = clampZero(dayPoint.consumed - dayPoint.gridImport)

    return {
      day: String(dayPoint.day),
      generated: dayPoint.generated,
      consumed: dayPoint.consumed,
      selfUse,
      gridImport: dayPoint.gridImport,
      saved: +(selfUse * rate).toFixed(1),
    }
  })

  const billPaidMap = new Map(bills.map((bill) => [bill.month, bill.paid]))
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
    }
  })

  const monthLabel = `${MONTH_LONG_TH[month - 1]} ${year + 543}`

  const hourlyMap = new Map(hourly.map((hourPoint) => [hourPoint.hour, hourPoint]))
  const zeroHour = { hour: 0, pv: 0, load: 0, soc: 0, batteryPower: 0, gridPower: 0 }
  const fullHourly = Array.from({ length: 24 }, (_, hour) => {
    const hourPoint = hourlyMap.get(hour) ?? { ...zeroHour, hour }
    return {
      hour: `${String(hour).padStart(2, '0')}:00`,
      pv: hourPoint.pv,
      load: hourPoint.load,
      net: +(hourPoint.pv - hourPoint.load).toFixed(2),
      batt: hourPoint.batteryPower,
      grid: hourPoint.gridPower,
    }
  })
  const hourlySoc = Array.from({ length: 24 }, (_, hour) => {
    const hourPoint = hourlyMap.get(hour)
    return { hour: `${String(hour).padStart(2, '0')}:00`, soc: hourPoint?.soc ?? 0 }
  })

  const full5Min = fiveMinRaw.map((sample) => ({
    minuteOfDay: sample.minuteOfDay,
    time: `${String(Math.floor(sample.minuteOfDay / 60)).padStart(2, '0')}:${String(sample.minuteOfDay % 60).padStart(2, '0')}`,
    pv: sample.pv,
    pv1: sample.pv1,
    pv2: sample.pv2,
    load: sample.load,
    net: +(sample.pv - sample.load).toFixed(2),
    batt: sample.batteryPower,
    grid: sample.gridPower,
    soc: sample.soc,
  }))

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
  }

  const recentDailyMap = new Map(recentDailyRows.map((row) => [row.date, row]))
  const recentDaily = Array.from({ length: 8 }, (_, index) => {
    const dateValue = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate() - (7 - index))
    const iso = formatISODate(dateValue)
    const row = recentDailyMap.get(iso) ?? { date: iso, generated: 0, consumed: 0, gridImport: 0 }
    const selfPowered = clampZero(row.consumed - row.gridImport)

    return {
      date: iso,
      generated: row.generated,
      consumed: row.consumed,
      gridImport: row.gridImport,
      selfPowered,
      selfSufficiencyPct: pct(selfPowered, row.consumed),
      gridDependencyPct: pct(row.gridImport, row.consumed),
    }
  })

  const previousDay = recentDaily.at(-2)
  const baselineDays = recentDaily.slice(0, -1)
  const trailing7Avg = {
    generated: average(
      baselineDays.map((entry) => entry.generated),
      1,
    ),
    consumed: average(
      baselineDays.map((entry) => entry.consumed),
      1,
    ),
    gridImport: average(
      baselineDays.map((entry) => entry.gridImport),
      1,
    ),
    selfPowered: average(
      baselineDays.map((entry) => entry.selfPowered),
      1,
    ),
    selfSufficiencyPct: average(
      baselineDays.map((entry) => entry.selfSufficiencyPct),
      0,
    ),
    gridDependencyPct: average(
      baselineDays.map((entry) => entry.gridDependencyPct),
      0,
    ),
  }

  const dayComparison = {
    previousDay,
    trailing7Avg,
    deltaFromPrevious: previousDay && {
      generated: changeFrom(dayFlow.generated, previousDay.generated),
      gridImport: changeFrom(dayFlow.gridImport, previousDay.gridImport),
      selfSufficiencyPct: changeFrom(dayFlow.selfSufficiencyPct, previousDay.selfSufficiencyPct),
    },
  }

  const histGen = rawMonths.reduce((sum, monthPoint) => sum + monthPoint.generated, 0)
  const histSolarUse = rawMonths.reduce((sum, monthPoint) => sum + clampZero(monthPoint.consumed - monthPoint.gridImport), 0)
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
    { name: 'พลังงานส่วนเกิน', value: discardedLife, key: 'clipped' },
  ]

  const totalSavedToDate = months.reduce((sum, monthPoint) => sum + monthPoint.saved, 0)
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

  const ageMinutes = Math.max(0, Math.round((Date.now() - new Date(live.lastUpdate).getTime()) / 60000))
  const freshness = {
    isOnline: live.isOnline,
    lastUpdate: live.lastUpdate,
    lastUpdateLabel: formatBangkokDateTime(live.lastUpdate),
    ageMinutes,
    isToday,
  }

  const alerts: Array<{ tone: 'ok' | 'info' | 'warn' | 'danger'; title: string; detail: string }> = [
    live.isOnline
      ? {
          tone: 'ok',
          title: 'ข้อมูลสดพร้อมใช้งาน',
          detail: ageMinutes <= 1 ? 'อัปเดตเมื่อสักครู่' : `อัปเดตล่าสุดเมื่อ ${ageMinutes} นาทีก่อน`,
        }
      : {
          tone: 'danger',
          title: 'อุปกรณ์ยังไม่ส่งข้อมูลสด',
          detail: `ล่าสุด ${formatBangkokDateTime(live.lastUpdate)}`,
        },
    ...(!isToday
      ? [
          {
            tone: 'info' as const,
            title: 'กำลังดูข้อมูลย้อนหลัง',
            detail: `วันที่ ${selectedISO}`,
          },
        ]
      : []),
    ...(live.gridVoltage < 210
      ? [
          {
            tone: 'warn' as const,
            title: 'แรงดันไฟต่ำกว่าปกติ',
            detail: `ตอนนี้ ${round(live.gridVoltage, 0)} V`,
          },
        ]
      : []),
    ...(live.gridVoltage > 245
      ? [
          {
            tone: 'warn' as const,
            title: 'แรงดันไฟสูงกว่าปกติ',
            detail: `ตอนนี้ ${round(live.gridVoltage, 0)} V`,
          },
        ]
      : []),
    ...(live.batterySoc <= 20
      ? [
          {
            tone: 'warn' as const,
            title: 'แบตเตอรี่สำรองเหลือน้อย',
            detail: `เหลือ ${round(live.batterySoc, 0)}% (${round(storedKwh, 1)} kWh)`,
          },
        ]
      : []),
  ]

  const monthPicker = rawMonths.map((monthPoint) => {
    const y = parseInt(monthPoint.month.slice(0, 4))
    const mo = parseInt(monthPoint.month.slice(5))
    return { value: monthPoint.month.replace('-', ''), label: `${MONTH_SHORT_TH[mo - 1]} ${String(y + 543).slice(-2)}` }
  })

  return {
    system: { ...SYSTEM, ratedPowerKw: live.powerRating || SYSTEM.ratedPowerKw },
    live,
    battery,
    pvStrings,
    systemHealth,
    freshness,
    alerts,
    today: { ...today, generationHours: hourly.filter((hourPoint) => hourPoint.pv > 0).length },
    day,
    dayFlow,
    dayComparison,
    monthDays: formattedMonthDays,
    monthLabel,
    monthPicker,
    months,
    gridOverview,
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

export async function getMonthLoad(year: number, month: number) {
  const monthDays = await getMonthDays(year, month)

  const daysInMonth = new Date(year, month, 0).getDate()
  const dayMap = new Map(monthDays.map((dayPoint) => [dayPoint.day, dayPoint]))
  const monthlyGridKwh = monthDays.reduce((sum, dayPoint) => sum + dayPoint.gridImport, 0)
  const rate = marginalRate(monthlyGridKwh || 320)

  const days = Array.from({ length: daysInMonth }, (_, index) => {
    const dayPoint = dayMap.get(index + 1) ?? { day: index + 1, generated: 0, consumed: 0, gridImport: 0 }
    const selfUse = clampZero(dayPoint.consumed - dayPoint.gridImport)

    return {
      day: String(dayPoint.day),
      generated: dayPoint.generated,
      consumed: dayPoint.consumed,
      selfUse,
      gridImport: dayPoint.gridImport,
      saved: +(selfUse * rate).toFixed(1),
    }
  })

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
