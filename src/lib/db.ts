import postgres from 'postgres'

// ponytail: singleton, 5 connections max — scale if needed
const sql = postgres(process.env.DATABASE_URL!, { ssl: false, max: 5 })

const DEVICE = process.env.SOLAR_DEVICE_ID!
const HOUSE_CA = process.env.MEA_HOUSE_CA!
const TZ = 'Asia/Bangkok'
const CO2_KG_PER_KWH = 0.4999 // Thailand grid emission factor

// ── Types ─────────────────────────────────────────────────────────────────────

export type LiveSnapshot = {
  pvPowerKw: number
  loadPowerKw: number
  batteryPowerKw: number // negative = charging
  batterySoc: number
  batterySoh: number
  gridPowerKw: number // negative = export to grid
  batteryVoltage: number
  batteryCurrent: number
  cyclePeriod: number
  pv1: { power: number; voltage: number; current: number }
  pv2: { power: number; voltage: number; current: number }
  gridVoltage: number
  totalGenerationTime: number
  isOnline: boolean
  lastUpdate: string
}

export type TodayData = {
  generated: number // kWh today (delta of totalPowerGeneration)
  consumed: number // kWh today (loadDayElectricityConsumption max)
  gridImport: number // kWh today (dayPurchaseElectricityConsumption max)
}

export type HourlyPoint = {
  hour: number // 0-23
  pv: number // kW avg
  load: number // kW avg
  soc: number // % avg
}

export type DayPoint = {
  day: number // day of month
  generated: number // kWh
  consumed: number // kWh
  gridImport: number // kWh
}

export type MonthPoint = {
  month: string // YYYY-MM
  generated: number
  consumed: number
  gridImport: number
}

export type LifetimeData = {
  generated: number // kWh total
  gridImport: number // kWh total
  generationTime: number // raw unit from inverter
  co2ReductionKg: number
}

export type Bill = {
  month: string // YYYYMM
  kwh: number
  paid: number
  unitUsedSolar: number
  amountUsedSolar: number
  income: number
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const n = (v: unknown) => Number(v ?? 0)

// ── Queries ───────────────────────────────────────────────────────────────────

/** ค่า snapshot ล่าสุดต่อ attr ทุกตัว → pivot เป็น object เดียว */
export async function getLiveSnapshot(): Promise<LiveSnapshot> {
  const rows = await sql<{ attr: string; value: string; recorded_at: Date }[]>`
    SELECT DISTINCT ON (attr) attr, value, recorded_at
    FROM stash.solar_record
    WHERE device_id = ${DEVICE}
    ORDER BY attr, recorded_at DESC
  `
  const m = Object.fromEntries(rows.map((r) => [r.attr, n(r.value)]))
  const lastUpdate = rows[0]?.recorded_at ?? new Date()
  // online = ข้อมูลล่าสุดไม่เกิน 15 นาที
  const isOnline = Date.now() - new Date(lastUpdate).getTime() < 15 * 60 * 1000

  return {
    pvPowerKw: m.generationPower ?? 0,
    loadPowerKw: m.totalLoadPower ?? 0,
    batteryPowerKw: m.batteryPower ?? 0,
    batterySoc: m.batterySOC ?? 0,
    batterySoh: m.batterySOH ?? 100,
    gridPowerKw: m.aPhaseFeederPower ?? 0,
    batteryVoltage: m.batteryVoltage ?? 0,
    batteryCurrent: m.batteryCurrent ?? 0,
    cyclePeriod: m.cyclePeriod ?? 0,
    pv1: { power: m.pv1Power ?? 0, voltage: m.pv1Voltage ?? 0, current: m.pv1Current ?? 0 },
    pv2: { power: m.pv2Power ?? 0, voltage: m.pv2Voltage ?? 0, current: m.pv2Current ?? 0 },
    gridVoltage: m.gridVoltage ?? 0,
    totalGenerationTime: m.totalGenerationTime ?? 0,
    isOnline,
    lastUpdate: new Date(lastUpdate).toISOString(),
  }
}

/** counters วันนี้ */
export async function getToday(): Promise<TodayData> {
  const rows = await sql<{ attr: string; value: string }[]>`
    SELECT attr,
           MAX(value::numeric) as value
    FROM stash.solar_record
    WHERE device_id = ${DEVICE}
      AND attr IN ('loadDayElectricityConsumption', 'dayPurchaseElectricityConsumption',
                   'totalPowerGeneration')
      AND recorded_at >= date_trunc('day', now() AT TIME ZONE ${TZ}) AT TIME ZONE ${TZ}
    GROUP BY attr
  `
  const cur = Object.fromEntries(rows.map((r) => [r.attr, n(r.value)]))

  // generated today = delta totalPowerGeneration (last - first of day)
  const [startRow] = await sql<{ value: string }[]>`
    SELECT value FROM stash.solar_record
    WHERE device_id = ${DEVICE} AND attr = 'totalPowerGeneration'
      AND recorded_at >= date_trunc('day', now() AT TIME ZONE ${TZ}) AT TIME ZONE ${TZ}
    ORDER BY recorded_at ASC LIMIT 1
  `
  const generated = Math.max(0, (cur.totalPowerGeneration ?? 0) - n(startRow?.value))

  return {
    generated,
    consumed: cur.loadDayElectricityConsumption ?? 0,
    gridImport: cur.dayPurchaseElectricityConsumption ?? 0,
  }
}

/** 24 จุดรายชั่วโมงของ date ที่กำหนด (default วันนี้) */
export async function getHourly(date?: Date): Promise<HourlyPoint[]> {
  const d = date ?? new Date()
  const dayStart = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

  const rows = await sql<{ hour: string; pv: string; load: string; soc: string }[]>`
    SELECT
      EXTRACT(HOUR FROM recorded_at AT TIME ZONE ${TZ})::int as hour,
      AVG(CASE WHEN attr = 'generationPower'  THEN value::numeric END) as pv,
      AVG(CASE WHEN attr = 'totalLoadPower'   THEN value::numeric END) as load,
      AVG(CASE WHEN attr = 'batterySOC'       THEN value::numeric END) as soc
    FROM stash.solar_record
    WHERE device_id = ${DEVICE}
      AND attr IN ('generationPower', 'totalLoadPower', 'batterySOC')
      AND (recorded_at AT TIME ZONE ${TZ})::date = ${dayStart}::date
    GROUP BY hour
    ORDER BY hour
  `
  return rows.map((r) => ({ hour: Number(r.hour), pv: n(r.pv), load: n(r.load), soc: n(r.soc) }))
}

/** รายวันของเดือน year/month (1-based) */
export async function getMonthDays(year: number, month: number): Promise<DayPoint[]> {
  const monthStr = `${year}-${String(month).padStart(2, '0')}`

  const rows = await sql<{ day: string; generated: string; consumed: string; grid_import: string }[]>`
    WITH daily AS (
      SELECT
        (recorded_at AT TIME ZONE ${TZ})::date as day,
        attr,
        MIN(value::numeric) as v_min,
        MAX(value::numeric) as v_max
      FROM stash.solar_record
      WHERE device_id = ${DEVICE}
        AND attr IN ('totalPowerGeneration', 'loadDayElectricityConsumption',
                     'dayPurchaseElectricityConsumption')
        AND to_char(recorded_at AT TIME ZONE ${TZ}, 'YYYY-MM') = ${monthStr}
      GROUP BY day, attr
    )
    SELECT
      day::text,
      MAX(CASE WHEN attr = 'totalPowerGeneration' THEN GREATEST(v_max - v_min, 0) END) as generated,
      MAX(CASE WHEN attr = 'loadDayElectricityConsumption' THEN v_max END) as consumed,
      MAX(CASE WHEN attr = 'dayPurchaseElectricityConsumption' THEN v_max END) as grid_import
    FROM daily
    GROUP BY day
    ORDER BY day
  `
  return rows.map((r) => ({
    day: new Date(r.day).getDate(),
    generated: n(r.generated),
    consumed: n(r.consumed),
    gridImport: n(r.grid_import),
  }))
}

/** สรุปรายเดือน n เดือนย้อนหลัง */
export async function getMonths(nMonths = 12): Promise<MonthPoint[]> {
  const rows = await sql<{ month: string; generated: string; consumed: string; grid_import: string }[]>`
    WITH daily AS (
      SELECT
        to_char(recorded_at AT TIME ZONE ${TZ}, 'YYYY-MM') as month,
        (recorded_at AT TIME ZONE ${TZ})::date as day,
        attr,
        MIN(value::numeric) as v_min,
        MAX(value::numeric) as v_max
      FROM stash.solar_record
      WHERE device_id = ${DEVICE}
        AND attr IN ('totalPowerGeneration', 'loadDayElectricityConsumption',
                     'dayPurchaseElectricityConsumption')
        AND recorded_at >= now() - (${nMonths} || ' months')::interval
      GROUP BY month, day, attr
    ),
    monthly AS (
      SELECT
        month,
        SUM(CASE WHEN attr = 'totalPowerGeneration' THEN GREATEST(v_max - v_min, 0) END) as generated,
        SUM(CASE WHEN attr = 'loadDayElectricityConsumption' THEN v_max END) as consumed,
        SUM(CASE WHEN attr = 'dayPurchaseElectricityConsumption' THEN v_max END) as grid_import
      FROM daily
      GROUP BY month
    )
    SELECT * FROM monthly ORDER BY month DESC LIMIT ${nMonths}
  `
  return rows.map((r) => ({
    month: r.month,
    generated: n(r.generated),
    consumed: n(r.consumed),
    gridImport: n(r.grid_import),
  }))
}

/** lifetime totals */
export async function getLifetime(): Promise<LifetimeData> {
  const [row] = await sql<{ generated: string; grid_import: string; gen_time: string }[]>`
    SELECT DISTINCT ON (1)
      MAX(CASE WHEN attr = 'totalPowerGeneration'               THEN value::numeric END) as generated,
      MAX(CASE WHEN attr = 'totalPurchaseElectricityConsumption' THEN value::numeric END) as grid_import,
      MAX(CASE WHEN attr = 'totalGenerationTime'                THEN value::numeric END) as gen_time
    FROM stash.solar_record
    WHERE device_id = ${DEVICE}
      AND attr IN ('totalPowerGeneration', 'totalPurchaseElectricityConsumption', 'totalGenerationTime')
  `
  const generated = n(row?.generated)
  return {
    generated,
    gridImport: n(row?.grid_import),
    generationTime: n(row?.gen_time),
    co2ReductionKg: Math.round(generated * CO2_KG_PER_KWH * 100) / 100,
  }
}

/** บิล MEA บ้าน n เดือนล่าสุด */
export async function getBills(nMonths = 12): Promise<Bill[]> {
  const rows = await sql<
    {
      month: string
      kwh: string
      paid: string
      unit_used_solar: string
      amount_used_solar: string
      income: string
    }[]
  >`
    SELECT month, kwh, paid, unit_used_solar, amount_used_solar, income
    FROM stash.mea_electric
    WHERE ca = ${HOUSE_CA}
    ORDER BY month DESC
    LIMIT ${nMonths}
  `
  return rows.map((r) => ({
    month: r.month,
    kwh: n(r.kwh),
    paid: n(r.paid),
    unitUsedSolar: n(r.unit_used_solar),
    amountUsedSolar: n(r.amount_used_solar),
    income: n(r.income),
  }))
}
