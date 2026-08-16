import { formatBangkokDateTime, getBangkokISODate } from './date'
import { getBatteryMorningSocPeak, getLiveSnapshot, getPvMorningBaseline, getPvMorningEnergy, type PvMorningBaseline, type PvMorningEnergy } from './db'
import { getAlertState, setAlertState } from './alert-state'
import { sendEnergyNotice, type EnergyNotice } from './line-notice'
import { logger } from './logger'

const MORNING_ALERT_MINUTE = 9 * 60
const EVENING_ALERT_MINUTE = 18 * 60

let running = false
let missingConfigLogged = false
let baselineCache: PvMorningBaseline | null = null

const numberEnv = (name: string, fallback: number, min: number, max: number) => {
  const value = Number(process.env[name])
  return Number.isFinite(value) ? Math.min(Math.max(value, min), max) : fallback
}

const oneDecimal = (value: number) => value.toLocaleString('th-TH', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const twoDecimals = (value: number) => value.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function getBangkokClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0)
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? 0)

  return { day: getBangkokISODate(now), minuteOfDay: hour * 60 + minute }
}

export function getDefaultSolarBaselineMonth(day: string) {
  const year = Number(day.slice(0, 4))
  const month = Number(day.slice(5, 7))
  return `${month >= 7 ? year : year - 1}-07`
}

export function getUnderperformingMppts(current: PvMorningEnergy, baseline: PvMorningBaseline, minimumRatio: number) {
  return [
    { name: 'MPPT 1', currentKwh: current.pv1Kwh, baselineKwh: baseline.pv1Kwh },
    { name: 'MPPT 2', currentKwh: current.pv2Kwh, baselineKwh: baseline.pv2Kwh },
  ].filter((mppt) => mppt.baselineKwh > 0 && mppt.currentKwh < mppt.baselineKwh * minimumRatio)
}

export function shouldAlertEveningBattery(batterySoc: number, maximumPct: number) {
  return batterySoc >= maximumPct
}

export function getDailyConditionTransition(state: { status: string; lastValue: string | null } | null, day: string, active: boolean) {
  if (active) return state?.status === 'alert' && state.lastValue === day ? 'none' : 'alert'
  if (state?.status === 'alert') return 'recovery'
  return state?.lastValue === day ? 'none' : 'record-normal'
}

export function getConnectionTransition(previousStatus: string | null, currentStatus: 'online' | 'offline') {
  if (previousStatus === currentStatus) return 'none'
  if (previousStatus === null && currentStatus === 'online') return 'record-online'
  return currentStatus === 'online' ? 'recovery' : 'alert'
}

async function handleDailyCondition(alertKey: string, day: string, active: boolean, alertNotice: EnergyNotice, recoveryNotice: EnergyNotice) {
  const state = await getAlertState(alertKey)
  const transition = getDailyConditionTransition(state, day, active)
  if (transition === 'none') return

  if (transition === 'alert') {
    await sendEnergyNotice(alertNotice)
    await setAlertState({ alertKey, status: 'alert', lastValue: day, notified: true })
    return
  }

  if (transition === 'recovery') {
    await sendEnergyNotice(recoveryNotice)
    await setAlertState({ alertKey, status: 'normal', lastValue: day, notified: true })
    return
  }

  await setAlertState({ alertKey, status: 'normal', lastValue: day })
}

async function checkDeviceConnection(live: Awaited<ReturnType<typeof getLiveSnapshot>>) {
  const alertKey = 'device-connection'
  const status = live.isOnline ? 'online' : 'offline'
  const state = await getAlertState(alertKey)
  const transition = getConnectionTransition(state?.status ?? null, status)
  if (transition === 'none') return

  if (transition === 'record-online') {
    await setAlertState({ alertKey, status, lastValue: live.lastUpdate })
    return
  }

  const notice: EnergyNotice = live.isOnline
    ? {
        tone: 'success',
        title: 'อุปกรณ์กลับมาออนไลน์แล้ว',
        fields: [
          { label: 'อุปกรณ์', value: process.env.SOLAR_DEVICE_ID ?? '-' },
          { label: 'ข้อมูลล่าสุด', value: formatBangkokDateTime(live.lastUpdate) },
        ],
      }
    : {
        tone: 'danger',
        title: 'อุปกรณ์ออฟไลน์',
        fields: [
          { label: 'อุปกรณ์', value: process.env.SOLAR_DEVICE_ID ?? '-' },
          { label: 'ข้อมูลล่าสุด', value: formatBangkokDateTime(live.lastUpdate) },
        ],
      }

  await sendEnergyNotice(notice)
  await setAlertState({ alertKey, status, lastValue: live.lastUpdate, notified: true })
}

async function checkMorningBattery(day: string, batterySoc: number, reservePct: number) {
  const peakSoc = await getBatteryMorningSocPeak(day)
  const active = peakSoc !== null && peakSoc <= reservePct

  const fields = [
    { label: 'SOC สูงสุด 06:00–09:00', value: peakSoc === null ? 'ไม่มีข้อมูล' : `${oneDecimal(peakSoc)}%` },
    { label: 'SOC ปัจจุบัน', value: `${oneDecimal(batterySoc)}%` },
    { label: 'ค่า reserve', value: `${oneDecimal(reservePct)}%` },
  ]

  await handleDailyCondition(
    'battery-morning',
    day,
    active,
    {
      tone: 'warning',
      title: 'แบตเตอรี่ยังไม่เริ่มชาร์จหลัง 09:00',
      fields,
    },
    {
      tone: 'success',
      title: 'แบตเตอรี่เริ่มชาร์จแล้ว',
      fields,
    },
  )
}

async function checkEveningBattery(day: string, batterySoc: number, maximumPct: number) {
  const fields = [
    { label: 'SOC ปัจจุบัน', value: `${oneDecimal(batterySoc)}%` },
    { label: 'เกณฑ์หลัง 18:00', value: `ต่ำกว่า ${oneDecimal(maximumPct)}%` },
  ]

  await handleDailyCondition(
    'battery-evening',
    day,
    shouldAlertEveningBattery(batterySoc, maximumPct),
    {
      tone: 'warning',
      title: `แบตเตอรี่ยังไม่ลดต่ำกว่า ${oneDecimal(maximumPct)}% หลัง 18:00`,
      fields,
    },
    {
      tone: 'success',
      title: `แบตเตอรี่ลดต่ำกว่า ${oneDecimal(maximumPct)}% แล้ว`,
      fields,
    },
  )
}

async function checkMorningSolar(day: string, baselineMonth: string, minimumRatio: number) {
  if (!baselineCache || baselineCache.month !== baselineMonth) baselineCache = await getPvMorningBaseline(baselineMonth)

  const current = await getPvMorningEnergy(day)
  const affected = getUnderperformingMppts(current, baselineCache, minimumRatio)
  const minimumPercent = Math.round(minimumRatio * 100)
  const allMppts = [
    { name: 'MPPT 1', currentKwh: current.pv1Kwh, baselineKwh: baselineCache.pv1Kwh },
    { name: 'MPPT 2', currentKwh: current.pv2Kwh, baselineKwh: baselineCache.pv2Kwh },
  ]

  await handleDailyCondition(
    'solar-morning',
    day,
    affected.length > 0,
    {
      tone: 'danger',
      title: affected.length === 1 ? `${affected[0].name} ผลิตไฟต่ำผิดปกติ` : 'ชุดแผงโซลาร์ผลิตไฟต่ำผิดปกติ',
      fields: [
        ...affected.map((mppt) => ({
          label: mppt.name,
          value: `${twoDecimals(mppt.currentKwh)} / ฐาน ${twoDecimals(mppt.baselineKwh)} kWh`,
        })),
        { label: 'เกณฑ์ขั้นต่ำ', value: `${minimumPercent}% ของค่าเฉลี่ย ${baselineMonth}` },
      ],
    },
    {
      tone: 'success',
      title: 'ชุดแผงโซลาร์กลับมาผลิตปกติแล้ว',
      fields: allMppts.map((mppt) => ({
        label: mppt.name,
        value: `${twoDecimals(mppt.currentKwh)} / ฐาน ${twoDecimals(mppt.baselineKwh)} kWh`,
      })),
    },
  )
}

async function runCycle(now: Date) {
  const noticeUrl = process.env.LINE_NOTICE_URL?.trim()
  const apiKey = process.env.LINE_NOTICE_API_KEY?.trim()
  if (!noticeUrl || !apiKey) {
    if (!missingConfigLogged) logger.warn('Energy Lib alerts disabled: LINE_NOTICE_URL or LINE_NOTICE_API_KEY is missing')
    missingConfigLogged = true
    return
  }
  missingConfigLogged = false

  const clock = getBangkokClock(now)
  const reservePct = numberEnv('ENERGY_ALERT_BATTERY_RESERVE_PCT', 15, 0, 100)
  const eveningMaximumPct = numberEnv('ENERGY_ALERT_BATTERY_EVENING_MAX_PCT', 95, 0, 100)
  const minimumSolarRatio = numberEnv('ENERGY_ALERT_SOLAR_MIN_RATIO', 0.2, 0, 1)
  const baselineMonth = process.env.ENERGY_ALERT_SOLAR_BASELINE_MONTH?.trim() || getDefaultSolarBaselineMonth(clock.day)
  const live = await getLiveSnapshot()

  await checkDeviceConnection(live)

  if (live.isOnline && clock.minuteOfDay >= MORNING_ALERT_MINUTE) {
    await checkMorningBattery(clock.day, live.batterySoc, reservePct)
    await checkMorningSolar(clock.day, baselineMonth, minimumSolarRatio)
  }

  if (live.isOnline && clock.minuteOfDay >= EVENING_ALERT_MINUTE) {
    await checkEveningBattery(clock.day, live.batterySoc, eveningMaximumPct)
  }
}

export async function runEnergyAlerts(now = new Date()) {
  if (running) return
  running = true
  try {
    await runCycle(now)
  } catch (err) {
    logger.error({ err }, 'Energy Lib alert cycle failed')
  } finally {
    running = false
  }
}
