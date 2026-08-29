import postgres from 'postgres'

// ponytail: singleton, 5 connections max — scale if needed
const sql = postgres(process.env.DATABASE_URL!, { ssl: false, max: 5 })

const DEVICE = process.env.SOLAR_DEVICE_ID!
const HOUSE_CA = process.env.MEA_HOUSE_CA!
const WATER_ACCOUNT = process.env.MWA_ACCOUNT_CODE ?? ''
const TZ = 'Asia/Bangkok'
const CO2_KG_PER_KWH = 0.4999 // Thailand grid emission factor

// ── Types ─────────────────────────────────────────────────────────────────────

export type SolarAlarm = {
  key: string
  level: number | null
  name: string | null
  description: string | null
  firedAt: string
  firedValue: string | null
}

export type LiveSnapshot = {
  pvPowerKw: number
  loadPowerKw: number
  batteryPowerKw: number // negative = charging
  batterySoc: number
  batterySoh: number | null
  gridPowerKw: number // negative = importing (buying from grid)
  batteryVoltage: number
  batteryCurrent: number
  cyclePeriod: number
  pv1: { power: number; voltage: number; current: number }
  pv2: { power: number; voltage: number; current: number }
  gridVoltage: number
  gridFrequencyHz: number | null
  totalGenerationTime: number
  powerRating: number // kW rated capacity from inverter
  offGridPowerKw: number
  isOnline: boolean
  lastUpdate: string
  batteryStatus: string | null
  firmwareVersion: string | null
  serialNumber: string | null
  activeAlarms: SolarAlarm[]
}

export type TodayData = {
  generated: number // kWh today from category_monthly station summary
  consumed: number // kWh today (loadDayElectricityConsumption max)
  gridImport: number // kWh today (dayPurchaseElectricityConsumption max)
  hasGenerationData: boolean
  hasUsageData: boolean
}

export type DailyTotal = {
  date: string // YYYY-MM-DD
  generated: number
  consumed: number
  gridImport: number
  hasGenerationData: boolean
  hasUsageData: boolean
}

export type HourlyPoint = {
  hour: number // 0-23
  pv: number // kW avg
  load: number // kW avg
  soc: number // % avg
  batteryPower: number // kW avg; + = discharging, - = charging
  gridPower: number // kW avg; - = importing (buying from grid)
}

export type DayPoint = {
  day: number // day of month
  generated: number // kWh
  consumed: number // kWh
  gridImport: number // kWh
  hasGenerationData: boolean
  hasUsageData: boolean
}

export type MonthPoint = {
  month: string // YYYY-MM
  generated: number
  consumed: number
  gridImport: number
  hasGenerationData: boolean
  hasUsageData: boolean
}

export type LifetimeData = {
  generated: number // kWh total
  gridImport: number // kWh total
  generationTime: number // raw unit from inverter
  co2ReductionKg: number
  hasGenerationData: boolean
}

export type Bill = {
  month: string // YYYYMM
  billNo: string | null
  billDate: Date | null
  kwh: number
  paid: number
  unitUsedSolar: number
  amountUsedSolar: number
  income: number
  billNoNormalized: string | null
  paymentBillNo: string | null
  paymentStatus: string | null
  paidAt: Date | null
  dueDate: Date | null
  outstandingAmount: number | null
  paymentAmount: number | null
  receiptNo: string | null
  paymentChannel: string | null
  paymentChannelSap: string | null
  paymentSyncedAt: Date | null
}

export type WaterUsage = {
  billNumber: string
  year: number
  month: number
  consumption: number
  billedAmount: number
  vatAmount: number
  paidAmount: number
  remainingAmount: number
  billDate: Date | null
  dueDate: Date | null
  readDate: Date | null
  paidDate: Date | null
  createdAt: Date
  isPaid: boolean
}

export type PvMorningEnergy = {
  pv1Kwh: number
  pv2Kwh: number
}

export type PvMorningBaseline = PvMorningEnergy & {
  days: number
  month: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const n = (v: unknown) => Number(v ?? 0)
const nullableN = (v: unknown) => (v === null || v === undefined ? null : Number(v))
const toDayString = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

function shiftDayString(day: string, days: number) {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function monthBounds(year: number, month: number) {
  const start = `${year}-${String(month).padStart(2, '0')}-01`
  const nextYear = month === 12 ? year + 1 : year
  const nextMonth = month === 12 ? 1 : month + 1
  const end = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`
  return { start, end }
}

// ── Queries ───────────────────────────────────────────────────────────────────

/** ค่า snapshot ล่าสุดต่อ attr ทุกตัว → pivot เป็น object เดียว */
export async function getLiveSnapshot(): Promise<LiveSnapshot> {
  const [rows, textRows, statusRows, deviceRows, alarmRows] = await Promise.all([
    sql<{ attr: string; value: string | null; recorded_at: Date }[]>`
      WITH attrs(attr) AS (
        VALUES
          ('generationPower'),
          ('totalLoadPower'),
          ('batteryPower'),
          ('batterySOC'),
          ('batterySOH'),
          ('aPhaseFeederPower'),
          ('batteryVoltage'),
          ('batteryCurrent'),
          ('cyclePeriod'),
          ('pv1Power'),
          ('pv1Voltage'),
          ('pv1Current'),
          ('pv2Power'),
          ('pv2Voltage'),
          ('pv2Current'),
          ('gridVoltage'),
          ('aPhaseGridFrequency'),
          ('totalGenerationTime'),
          ('powerRating'),
          ('offGridPortTotalPower')
      )
      SELECT attrs.attr, latest.value, latest.recorded_at
      FROM attrs
      CROSS JOIN LATERAL (
        SELECT value, recorded_at
        FROM stash.solar_record
        WHERE device_id = ${DEVICE}
          AND attr = attrs.attr
        ORDER BY recorded_at DESC
        LIMIT 1
      ) latest
    `,
    sql<{ attr: string; display_value: string | null }[]>`
      WITH attrs(attr) AS (VALUES ('firmwareVersion'), ('productSerialNumber'))
      SELECT attrs.attr, latest.display_value
      FROM attrs
      CROSS JOIN LATERAL (
        SELECT COALESCE(value_display, value_text, value::text) AS display_value
        FROM stash.solar_record
        WHERE device_id = ${DEVICE} AND attr = attrs.attr
        ORDER BY recorded_at DESC
        LIMIT 1
      ) latest
    `,
    sql<{ display_value: string | null }[]>`
      WITH newest AS (
        SELECT MAX(recorded_at) AS recorded_at
        FROM stash.solar_record
        WHERE device_id = ${DEVICE} AND attr = 'batteryStatus'
      )
      SELECT COALESCE(value_display, value_text, value::text) AS display_value
      FROM stash.solar_record, newest
      WHERE device_id = ${DEVICE}
        AND attr = 'batteryStatus'
        AND stash.solar_record.recorded_at >= newest.recorded_at - INTERVAL '1 minute'
      ORDER BY
        (source IN ('latest_state', 'energy_flow_state', 'record_list')) DESC,
        stash.solar_record.recorded_at DESC
      LIMIT 1
    `,
    sql<
      {
        serial_number: string | null
        software_version: string | null
        is_online: boolean | null
        last_data_at: Date | null
      }[]
    >`
      SELECT serial_number, software_version, is_online, last_data_at
      FROM stash.solar_device_snapshot
      WHERE device_id = ${DEVICE}
      ORDER BY observed_at DESC
      LIMIT 1
    `,
    sql<
      {
        alarm_key: string
        level: number | null
        name: string | null
        description: string | null
        fired_at: Date
        fired_value: string | null
      }[]
    >`
      SELECT alarm_key, level, name, description, fired_at, fired_value
      FROM stash.solar_alarm
      WHERE device_id = ${DEVICE} AND cleared_at IS NULL
      ORDER BY fired_at DESC
      LIMIT 5
    `,
  ])
  const m = Object.fromEntries(rows.flatMap((row) => (row.value === null ? [] : [[row.attr, Number(row.value)]])))
  const text = Object.fromEntries(textRows.map((row) => [row.attr, row.display_value]))
  const latestTelemetryAt = rows.reduce<Date | null>((latest, row) => (!latest || row.recorded_at > latest ? row.recorded_at : latest), null)
  const device = deviceRows[0]
  const lastUpdate = device?.last_data_at ?? latestTelemetryAt
  const isFresh = lastUpdate !== null && Date.now() - lastUpdate.getTime() < 15 * 60 * 1000
  const isOnline = isFresh && device?.is_online !== false

  return {
    pvPowerKw: m.generationPower ?? 0,
    loadPowerKw: m.totalLoadPower ?? 0,
    batteryPowerKw: m.batteryPower ?? 0,
    batterySoc: m.batterySOC ?? 0,
    batterySoh: m.batterySOH ?? null,
    gridPowerKw: m.aPhaseFeederPower ?? 0,
    batteryVoltage: m.batteryVoltage ?? 0,
    batteryCurrent: m.batteryCurrent ?? 0,
    cyclePeriod: m.cyclePeriod ?? 0,
    pv1: { power: m.pv1Power ?? 0, voltage: m.pv1Voltage ?? 0, current: m.pv1Current ?? 0 },
    pv2: { power: m.pv2Power ?? 0, voltage: m.pv2Voltage ?? 0, current: m.pv2Current ?? 0 },
    gridVoltage: m.gridVoltage ?? 0,
    gridFrequencyHz: m.aPhaseGridFrequency ?? null,
    totalGenerationTime: m.totalGenerationTime ?? 0,
    powerRating: m.powerRating ?? 0,
    offGridPowerKw: m.offGridPortTotalPower ?? 0,
    isOnline,
    lastUpdate: (lastUpdate ?? new Date(0)).toISOString(),
    batteryStatus: statusRows[0]?.display_value ?? null,
    firmwareVersion: text.firmwareVersion ?? device?.software_version ?? null,
    serialNumber: text.productSerialNumber ?? device?.serial_number ?? null,
    activeAlarms: alarmRows.map((alarm) => ({
      key: alarm.alarm_key,
      level: alarm.level,
      name: alarm.name,
      description: alarm.description,
      firedAt: alarm.fired_at.toISOString(),
      firedValue: alarm.fired_value,
    })),
  }
}

/** counters วันนี้ หรือ date ที่กำหนด */
export async function getToday(date?: Date): Promise<TodayData> {
  const d = date ?? new Date()
  const dayStr = toDayString(d)
  const nextDayStr = shiftDayString(dayStr, 1)

  const [row] = await sql<{ generated: string | null; consumed: string | null; grid_import: string | null }[]>`
    SELECT
      (
        SELECT value
        FROM stash.solar_station_summary
        WHERE station_id = (
            SELECT station_id
            FROM stash.solar_device_snapshot
            WHERE device_id = ${DEVICE}
            ORDER BY observed_at DESC
            LIMIT 1
          )
          AND source = 'category_monthly'
          AND category_key = 'pvInverterElectricityQuantityClass'
          AND attr = 'pvGeneratedEnergy'
          AND time_key = ${dayStr}
          AND is_real_value IS NOT FALSE
        LIMIT 1
      ) AS generated,
      MAX(value) FILTER (WHERE attr = 'loadDayElectricityConsumption') AS consumed,
      MAX(value) FILTER (WHERE attr = 'dayPurchaseElectricityConsumption') AS grid_import
    FROM stash.solar_record
    WHERE device_id = ${DEVICE}
      AND attr IN ('loadDayElectricityConsumption', 'dayPurchaseElectricityConsumption')
      AND recorded_at >= (${dayStr} || ' 00:00 ' || ${TZ})::timestamptz
      AND recorded_at < (${nextDayStr} || ' 00:00 ' || ${TZ})::timestamptz
  `

  return {
    generated: n(row?.generated),
    consumed: n(row?.consumed),
    gridImport: n(row?.grid_import),
    hasGenerationData: row?.generated != null,
    hasUsageData: row?.consumed != null || row?.grid_import != null,
  }
}

export type MinutePoint = {
  minuteOfDay: number // actual minutes from midnight (0-1439)
  pv: number
  pv1: number
  pv2: number
  load: number
  soc: number
  batteryPower: number
  gridPower: number
}

/** จุดข้อมูลตาม recorded_at จริง (ข้อมูลเข้าทุก ~5 นาที) */
export async function get5Min(date?: Date): Promise<MinutePoint[]> {
  const d = date ?? new Date()
  const dayStart = toDayString(d)
  const dayEnd = shiftDayString(dayStart, 1)

  const rows = await sql<{ minute_of_day: string; pv: string; pv1: string; pv2: string; load: string; soc: string; battery_power: string; grid_power: string }[]>`
    SELECT
      EXTRACT(EPOCH FROM (recorded_at AT TIME ZONE ${TZ} - date_trunc('day', recorded_at AT TIME ZONE ${TZ})))::int / 60 as minute_of_day,
      AVG(CASE WHEN attr = 'generationPower'   THEN value::numeric END) as pv,
      AVG(CASE WHEN attr = 'pv1Power'          THEN value::numeric END) as pv1,
      AVG(CASE WHEN attr = 'pv2Power'          THEN value::numeric END) as pv2,
      AVG(CASE WHEN attr = 'totalLoadPower'    THEN value::numeric END) as load,
      AVG(CASE WHEN attr = 'batterySOC'        THEN value::numeric END) as soc,
      AVG(CASE WHEN attr = 'batteryPower'      THEN value::numeric END) as battery_power,
      AVG(CASE WHEN attr = 'aPhaseFeederPower' THEN value::numeric END) as grid_power
    FROM stash.solar_record
    WHERE device_id = ${DEVICE}
      AND attr IN ('generationPower', 'pv1Power', 'pv2Power', 'totalLoadPower', 'batterySOC', 'batteryPower', 'aPhaseFeederPower')
      AND recorded_at >= (${dayStart} || ' 00:00 ' || ${TZ})::timestamptz
      AND recorded_at < (${dayEnd} || ' 00:00 ' || ${TZ})::timestamptz
    GROUP BY minute_of_day
    ORDER BY minute_of_day
  `
  return rows.map((r) => ({
    minuteOfDay: Number(r.minute_of_day),
    pv: n(r.pv),
    pv1: n(r.pv1),
    pv2: n(r.pv2),
    load: n(r.load),
    soc: n(r.soc),
    batteryPower: n(r.battery_power),
    gridPower: n(r.grid_power),
  }))
}

/** 24 จุดรายชั่วโมงของ date ที่กำหนด (default วันนี้) */
export async function getHourly(date?: Date): Promise<HourlyPoint[]> {
  const d = date ?? new Date()
  const dayStart = toDayString(d)
  const dayEnd = shiftDayString(dayStart, 1)

  const rows = await sql<{ hour: string; pv: string; load: string; soc: string; battery_power: string; grid_power: string }[]>`
    SELECT
      EXTRACT(HOUR FROM recorded_at AT TIME ZONE ${TZ})::int as hour,
      AVG(CASE WHEN attr = 'generationPower'    THEN value::numeric END) as pv,
      AVG(CASE WHEN attr = 'totalLoadPower'     THEN value::numeric END) as load,
      AVG(CASE WHEN attr = 'batterySOC'         THEN value::numeric END) as soc,
      AVG(CASE WHEN attr = 'batteryPower'       THEN value::numeric END) as battery_power,
      AVG(CASE WHEN attr = 'aPhaseFeederPower'  THEN value::numeric END) as grid_power
    FROM stash.solar_record
    WHERE device_id = ${DEVICE}
      AND attr IN ('generationPower', 'totalLoadPower', 'batterySOC', 'batteryPower', 'aPhaseFeederPower')
      AND recorded_at >= (${dayStart} || ' 00:00 ' || ${TZ})::timestamptz
      AND recorded_at < (${dayEnd} || ' 00:00 ' || ${TZ})::timestamptz
    GROUP BY hour
    ORDER BY hour
  `
  return rows.map((r) => ({
    hour: Number(r.hour),
    pv: n(r.pv),
    load: n(r.load),
    soc: n(r.soc),
    batteryPower: n(r.battery_power),
    gridPower: n(r.grid_power),
  }))
}

/** peak all-time สำหรับแต่ละ MPPT string */
export async function getPvPeak(): Promise<{ pv1: number; pv2: number }> {
  const rows = await sql<{ attr: string; value: string }[]>`
    SELECT attr, MAX(value::numeric) as value
    FROM stash.solar_record
    WHERE device_id = ${DEVICE} AND attr IN ('pv1Power', 'pv2Power')
    GROUP BY attr
  `
  const m = Object.fromEntries(rows.map((r) => [r.attr, n(r.value)]))
  return { pv1: m.pv1Power ?? 0, pv2: m.pv2Power ?? 0 }
}

/** รายวันของเดือน year/month (1-based) */
export async function getMonthDays(year: number, month: number): Promise<DayPoint[]> {
  const { start, end } = monthBounds(year, month)

  const rows = await sql<{ day: string; generated: string | null; consumed: string | null; grid_import: string | null }[]>`
    WITH production AS (
      SELECT time_key::date AS day, value AS generated
      FROM stash.solar_station_summary
      WHERE station_id = (
          SELECT station_id
          FROM stash.solar_device_snapshot
          WHERE device_id = ${DEVICE}
          ORDER BY observed_at DESC
          LIMIT 1
        )
        AND source = 'category_monthly'
        AND category_key = 'pvInverterElectricityQuantityClass'
        AND attr = 'pvGeneratedEnergy'
        AND time_key >= ${start}
        AND time_key < ${end}
        AND is_real_value IS NOT FALSE
    ),
    telemetry AS (
      SELECT
        (recorded_at AT TIME ZONE ${TZ})::date as day,
        attr,
        MAX(value) as v_max
      FROM stash.solar_record
      WHERE device_id = ${DEVICE}
        AND attr IN ('loadDayElectricityConsumption', 'dayPurchaseElectricityConsumption')
        AND recorded_at >= (${start} || ' 00:00 ' || ${TZ})::timestamptz
        AND recorded_at < (${end} || ' 00:00 ' || ${TZ})::timestamptz
      GROUP BY day, attr
    ),
    usage AS (
      SELECT
        day,
        MAX(v_max) FILTER (WHERE attr = 'loadDayElectricityConsumption') AS consumed,
        MAX(v_max) FILTER (WHERE attr = 'dayPurchaseElectricityConsumption') AS grid_import
      FROM telemetry
      GROUP BY day
    )
    SELECT
      COALESCE(production.day, usage.day)::text AS day,
      production.generated,
      usage.consumed,
      usage.grid_import
    FROM production
    FULL OUTER JOIN usage ON usage.day = production.day
    ORDER BY day
  `
  return rows.map((r) => ({
    day: new Date(r.day).getDate(),
    generated: n(r.generated),
    consumed: n(r.consumed),
    gridImport: n(r.grid_import),
    hasGenerationData: r.generated != null,
    hasUsageData: r.consumed != null || r.grid_import != null,
  }))
}

/** Daily totals in a date window ending at endDate, inclusive. */
export async function getRecentDailyTotals(endDate: Date, days = 8): Promise<DailyTotal[]> {
  const end = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate())
  const start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - (days - 1))
  const startStr = toDayString(start)
  const endStr = toDayString(end)
  const endExclusiveStr = shiftDayString(endStr, 1)

  const rows = await sql<{ day: string; generated: string | null; consumed: string | null; grid_import: string | null }[]>`
    WITH production AS (
      SELECT time_key::date AS day, value AS generated
      FROM stash.solar_station_summary
      WHERE station_id = (
          SELECT station_id
          FROM stash.solar_device_snapshot
          WHERE device_id = ${DEVICE}
          ORDER BY observed_at DESC
          LIMIT 1
        )
        AND source = 'category_monthly'
        AND category_key = 'pvInverterElectricityQuantityClass'
        AND attr = 'pvGeneratedEnergy'
        AND time_key >= ${startStr}
        AND time_key < ${endExclusiveStr}
        AND is_real_value IS NOT FALSE
    ),
    telemetry AS (
      SELECT
        (recorded_at AT TIME ZONE ${TZ})::date as day,
        attr,
        MAX(value) as v_max
      FROM stash.solar_record
      WHERE device_id = ${DEVICE}
        AND attr IN ('loadDayElectricityConsumption', 'dayPurchaseElectricityConsumption')
        AND recorded_at >= (${startStr} || ' 00:00 ' || ${TZ})::timestamptz
        AND recorded_at < (${endExclusiveStr} || ' 00:00 ' || ${TZ})::timestamptz
      GROUP BY day, attr
    ),
    usage AS (
      SELECT
        day,
        MAX(v_max) FILTER (WHERE attr = 'loadDayElectricityConsumption') AS consumed,
        MAX(v_max) FILTER (WHERE attr = 'dayPurchaseElectricityConsumption') AS grid_import
      FROM telemetry
      GROUP BY day
    )
    SELECT
      COALESCE(production.day, usage.day)::text AS day,
      production.generated,
      usage.consumed,
      usage.grid_import
    FROM production
    FULL OUTER JOIN usage ON usage.day = production.day
    ORDER BY day
  `

  return rows.map((row) => ({
    date: row.day,
    generated: n(row.generated),
    consumed: n(row.consumed),
    gridImport: n(row.grid_import),
    hasGenerationData: row.generated != null,
    hasUsageData: row.consumed != null || row.grid_import != null,
  }))
}

/** สรุปรายเดือน n เดือนย้อนหลัง */
export async function getMonths(nMonths = 12): Promise<MonthPoint[]> {
  const rows = await sql<{ month: string; generated: string | null; consumed: string | null; grid_import: string | null }[]>`
    WITH production AS (
      SELECT time_key AS month, value AS generated
      FROM stash.solar_station_summary
      WHERE station_id = (
          SELECT station_id
          FROM stash.solar_device_snapshot
          WHERE device_id = ${DEVICE}
          ORDER BY observed_at DESC
          LIMIT 1
        )
        AND source = 'category_yearly'
        AND category_key = 'pvInverterElectricityQuantityClass'
        AND attr = 'pvGeneratedEnergy'
        AND time_key >= to_char((now() AT TIME ZONE ${TZ}) - (${nMonths - 1} || ' months')::interval, 'YYYY-MM')
        AND time_key <= to_char(now() AT TIME ZONE ${TZ}, 'YYYY-MM')
        AND is_real_value IS NOT FALSE
    ),
    daily AS (
      SELECT
        to_char(recorded_at AT TIME ZONE ${TZ}, 'YYYY-MM') as month,
        (recorded_at AT TIME ZONE ${TZ})::date as day,
        attr,
        MAX(value::numeric) as v_max
      FROM stash.solar_record
      WHERE device_id = ${DEVICE}
        AND attr IN ('loadDayElectricityConsumption', 'dayPurchaseElectricityConsumption')
        AND recorded_at >= now() - (${nMonths} || ' months')::interval
      GROUP BY month, day, attr
    ),
    usage AS (
      SELECT
        month,
        SUM(CASE WHEN attr = 'loadDayElectricityConsumption' THEN v_max END) as consumed,
        SUM(CASE WHEN attr = 'dayPurchaseElectricityConsumption' THEN v_max END) as grid_import
      FROM daily
      GROUP BY month
    )
    SELECT
      COALESCE(production.month, usage.month) AS month,
      production.generated,
      usage.consumed,
      usage.grid_import
    FROM production
    FULL OUTER JOIN usage ON usage.month = production.month
    ORDER BY month DESC
    LIMIT ${nMonths}
  `
  return rows.map((r) => ({
    month: r.month,
    generated: n(r.generated),
    consumed: n(r.consumed),
    gridImport: n(r.grid_import),
    hasGenerationData: r.generated != null,
    hasUsageData: r.consumed != null || r.grid_import != null,
  }))
}

/** Estimate charged-to-battery energy from negative batteryPower samples. */
export async function getBatteryCharge(nMonths = 12): Promise<number> {
  const [row] = await sql<{ charged: string }[]>`
    WITH points AS (
      SELECT
        recorded_at,
        GREATEST(-(value::numeric), 0) as charge_kw,
        LEAD(recorded_at) OVER (ORDER BY recorded_at) as next_at
      FROM stash.solar_record
      WHERE device_id = ${DEVICE}
        AND attr = 'batteryPower'
        AND recorded_at >= now() - (${nMonths} || ' months')::interval
    )
    SELECT COALESCE(
      SUM(charge_kw * LEAST(EXTRACT(EPOCH FROM (next_at - recorded_at)) / 3600, 0.25)),
      0
    ) as charged
    FROM points
    WHERE next_at IS NOT NULL
  `
  return n(row?.charged)
}

/** lifetime totals */
export async function getLifetime(): Promise<LifetimeData> {
  const [row] = await sql<{ generated: string | null; grid_import: string | null; gen_time: string | null }[]>`
    SELECT
      (
        SELECT SUM(value)
        FROM stash.solar_station_summary
        WHERE station_id = (
            SELECT station_id
            FROM stash.solar_device_snapshot
            WHERE device_id = ${DEVICE}
            ORDER BY observed_at DESC
            LIMIT 1
          )
          AND source = 'generated_total'
          AND category_key = 'generatedEnergy'
          AND attr = 'generatedEnergy'
          AND is_real_value IS NOT FALSE
      ) AS generated,
      MAX(CASE WHEN attr = 'totalPurchaseElectricityConsumption' THEN value::numeric END) as grid_import,
      MAX(CASE WHEN attr = 'totalGenerationTime'                THEN value::numeric END) as gen_time
    FROM stash.solar_record
    WHERE device_id = ${DEVICE}
      AND attr IN ('totalPurchaseElectricityConsumption', 'totalGenerationTime')
  `
  const generated = n(row?.generated)
  return {
    generated,
    gridImport: n(row?.grid_import),
    generationTime: n(row?.gen_time),
    co2ReductionKg: Math.round(generated * CO2_KG_PER_KWH * 100) / 100,
    hasGenerationData: row?.generated != null,
  }
}

/** บิล MEA บ้าน n เดือนล่าสุด */
export async function getBills(nMonths = 12): Promise<Bill[]> {
  const rows = await sql<
    {
      month: string
      bill_no: string | null
      bill_date: Date | null
      kwh: string
      paid: string
      unit_used_solar: string
      amount_used_solar: string
      income: string
      bill_no_normalized: string | null
      payment_bill_no: string | null
      payment_status: string | null
      paid_at: Date | null
      due_date: Date | null
      outstanding_amount: string | null
      payment_amount: string | null
      receipt_no: string | null
      payment_channel: string | null
      payment_channel_sap: string | null
      payment_synced_at: Date | null
    }[]
  >`
    SELECT
      month,
      bill_no,
      bill_date,
      kwh,
      paid,
      unit_used_solar,
      amount_used_solar,
      income,
      bill_no_normalized,
      payment_bill_no,
      payment_status,
      paid_at,
      due_date,
      outstanding_amount,
      payment_amount,
      receipt_no,
      payment_channel,
      payment_channel_sap,
      payment_synced_at
    FROM stash.mea_electric
    WHERE ca = ${HOUSE_CA}
    ORDER BY month DESC
    LIMIT ${nMonths}
  `
  return rows.map((r) => ({
    month: r.month,
    billNo: r.bill_no,
    billDate: r.bill_date,
    kwh: n(r.kwh),
    paid: n(r.paid),
    unitUsedSolar: n(r.unit_used_solar),
    amountUsedSolar: n(r.amount_used_solar),
    income: n(r.income),
    billNoNormalized: r.bill_no_normalized,
    paymentBillNo: r.payment_bill_no,
    paymentStatus: r.payment_status,
    paidAt: r.paid_at,
    dueDate: r.due_date,
    outstandingAmount: nullableN(r.outstanding_amount),
    paymentAmount: nullableN(r.payment_amount),
    receiptNo: r.receipt_no,
    paymentChannel: r.payment_channel,
    paymentChannelSap: r.payment_channel_sap,
    paymentSyncedAt: r.payment_synced_at,
  }))
}

/** พลังงานแยก MPPT ช่วง 06:00–09:00 ของวันที่กำหนด (ข้อมูลเข้าประมาณทุก 5 นาที) */
export async function getPvMorningEnergy(day: string): Promise<PvMorningEnergy> {
  const [row] = await sql<{ pv1_kwh: string; pv2_kwh: string }[]>`
    SELECT
      COALESCE(SUM(CASE WHEN attr = 'pv1Power' THEN GREATEST(value, 0) ELSE 0 END) * (5.0 / 60.0), 0) AS pv1_kwh,
      COALESCE(SUM(CASE WHEN attr = 'pv2Power' THEN GREATEST(value, 0) ELSE 0 END) * (5.0 / 60.0), 0) AS pv2_kwh
    FROM stash.solar_record
    WHERE device_id = ${DEVICE}
      AND attr IN ('pv1Power', 'pv2Power')
      AND recorded_at >= (${day} || ' 06:00 ' || ${TZ})::timestamptz
      AND recorded_at < (${day} || ' 09:00 ' || ${TZ})::timestamptz
  `

  return { pv1Kwh: n(row?.pv1_kwh), pv2Kwh: n(row?.pv2_kwh) }
}

/** ค่าเฉลี่ยพลังงานรายวันแยก MPPT ช่วง 06:00–09:00 รวมวันที่ไม่มีข้อมูลเป็น 0 */
export async function getPvMorningBaseline(month: string): Promise<PvMorningBaseline> {
  const monthStart = `${month}-01`
  const [row] = await sql<{ pv1_kwh: string; pv2_kwh: string; days: string }[]>`
    WITH days AS (
      SELECT generate_series(
        ${monthStart}::date,
        (${monthStart}::date + interval '1 month - 1 day')::date,
        interval '1 day'
      )::date AS day
    ), daily AS (
      SELECT
        (recorded_at AT TIME ZONE ${TZ})::date AS day,
        attr,
        SUM(GREATEST(value, 0)) * (5.0 / 60.0) AS kwh
      FROM stash.solar_record
      WHERE device_id = ${DEVICE}
        AND attr IN ('pv1Power', 'pv2Power')
        AND recorded_at >= (${monthStart} || ' 00:00 ' || ${TZ})::timestamptz
        AND recorded_at < ((${monthStart}::text::date + interval '1 month')::date::text || ' 00:00 ' || ${TZ})::timestamptz
        AND (recorded_at AT TIME ZONE ${TZ})::time >= time '06:00'
        AND (recorded_at AT TIME ZONE ${TZ})::time < time '09:00'
      GROUP BY 1, 2
    )
    SELECT
      AVG(COALESCE(pv1.kwh, 0)) AS pv1_kwh,
      AVG(COALESCE(pv2.kwh, 0)) AS pv2_kwh,
      COUNT(*) AS days
    FROM days
    LEFT JOIN daily pv1 ON pv1.day = days.day AND pv1.attr = 'pv1Power'
    LEFT JOIN daily pv2 ON pv2.day = days.day AND pv2.attr = 'pv2Power'
  `

  return {
    month,
    days: n(row?.days),
    pv1Kwh: n(row?.pv1_kwh),
    pv2Kwh: n(row?.pv2_kwh),
  }
}

/** SOC สูงสุดของแบตเตอรี่ในช่วง 06:00–09:00 ใช้ตรวจว่าพ้นค่า reserve แล้วหรือยัง */
export async function getBatteryMorningSocPeak(day: string): Promise<number | null> {
  const [row] = await sql<{ peak_soc: string | null }[]>`
    SELECT MAX(value) AS peak_soc
    FROM stash.solar_record
    WHERE device_id = ${DEVICE}
      AND attr = 'batterySOC'
      AND recorded_at >= (${day} || ' 06:00 ' || ${TZ})::timestamptz
      AND recorded_at < (${day} || ' 09:00 ' || ${TZ})::timestamptz
  `

  return row?.peak_soc === null || row?.peak_soc === undefined ? null : n(row.peak_soc)
}

/** ปริมาณใช้น้ำจากรอบอ่านมิเตอร์ MWA ล่าสุด โดยตัดรายการค่าธรรมเนียมที่ไม่มีวันอ่านมิเตอร์ออก */
export async function getWaterUsage(nMonths = 12): Promise<WaterUsage[]> {
  const rows = await sql<
    {
      bill_number: string
      period_year: number
      period_month: number
      consumption: string
      gross_amount: string
      vat_amount: string
      paid_amount: string
      balance_gross_amount: string
      bill_date: Date | null
      bill_due_date: Date | null
      current_read_date: Date | null
      paid_date: Date | null
      created_at: Date
    }[]
  >`
    SELECT DISTINCT ON (period_year, period_month)
      bill_number,
      period_year,
      period_month,
      consumption,
      gross_amount,
      vat_amount,
      paid_amount,
      balance_gross_amount,
      bill_date,
      bill_due_date,
      current_read_date,
      paid_date,
      created_at
    FROM stash.mwa_water
    WHERE account_code = COALESCE(
      NULLIF(${WATER_ACCOUNT}, ''),
      (SELECT account_code FROM stash.mwa_account ORDER BY account_code LIMIT 1)
    )
      AND current_read_date IS NOT NULL
      AND period_year IS NOT NULL
      AND period_month BETWEEN 1 AND 12
    ORDER BY period_year DESC, period_month DESC, current_read_date DESC, created_at DESC
    LIMIT ${nMonths}
  `

  return rows.map((row) => {
    const paidAmount = n(row.paid_amount)
    const remainingAmount = n(row.balance_gross_amount)

    return {
      billNumber: row.bill_number,
      year: Number(row.period_year),
      month: Number(row.period_month),
      consumption: n(row.consumption),
      billedAmount: n(row.gross_amount),
      vatAmount: n(row.vat_amount),
      paidAmount,
      remainingAmount,
      billDate: row.bill_date,
      dueDate: row.bill_due_date,
      readDate: row.current_read_date,
      paidDate: row.paid_date,
      createdAt: row.created_at,
      isPaid: Boolean(row.paid_date) && paidAmount > 0 && remainingAmount <= 0,
    }
  })
}
