import { createAlertWorker, runAlertChecks } from './alert-worker'
import { config } from './config'
import { cacheData } from './data-cache'
import { formatBangkokDateTime, getBangkokISODate } from './date'
import { getBatteryMorningSocPeak, getLiveSnapshot, getPvMorningBaseline, getPvMorningEnergy, type PvMorningBaseline, type PvMorningEnergy } from './db'
import { getAlertState, setAlertState } from './alert-state'
import { num } from './electricity'
import { sendEnergyNotice, sendEnergyTextNotice, type EnergyNotice } from './line-notice'

const MORNING_ALERT_MINUTE = 9 * 60
const EVENING_ALERT_MINUTE = 18 * 60
/** ฐาน MPPT เป็นค่าเฉลี่ยของเดือนที่ปิดแล้ว — cache สั้นๆ พอให้ backfill มีผลโดยไม่ต้อง restart */
const BASELINE_CACHE_MS = 6 * 60 * 60_000

const oneDecimal = (value: number) => num(value, 1)
const twoDecimals = (value: number) => num(value, 2)

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

/** จับคู่ค่าที่ผลิตได้เช้านี้กับค่าฐานของแต่ละ MPPT */
function mpptPairs(current: PvMorningEnergy, baseline: Pick<PvMorningBaseline, 'pv1Kwh' | 'pv2Kwh'>) {
  return [
    { name: 'MPPT 1', currentKwh: current.pv1Kwh, baselineKwh: baseline.pv1Kwh },
    { name: 'MPPT 2', currentKwh: current.pv2Kwh, baselineKwh: baseline.pv2Kwh },
  ]
}

export function getUnderperformingMppts(current: PvMorningEnergy, baseline: PvMorningBaseline, minimumRatio: number) {
  return mpptPairs(current, baseline).filter((mppt) => mppt.baselineKwh > 0 && mppt.currentKwh < mppt.baselineKwh * minimumRatio)
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

  // อ่านจบในบรรทัดเดียว → ส่งเป็น text ธรรมดา ไม่ต้องทำเป็น Flex card
  // และไม่ใส่รหัสเครื่อง เพราะดูแล้วไม่รู้ว่าเลขอะไร
  const lastUpdate = formatBangkokDateTime(live.lastUpdate)
  const text = live.isOnline ? `อุปกรณ์กลับมาออนไลน์แล้ว · ข้อมูลล่าสุด ${lastUpdate}` : `อุปกรณ์ออฟไลน์ · ข้อมูลล่าสุด ${lastUpdate}`

  await sendEnergyTextNotice(text)
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
  const baseline = await cacheData(`pv-morning-baseline:${baselineMonth}`, BASELINE_CACHE_MS, () => getPvMorningBaseline(baselineMonth))

  const current = await getPvMorningEnergy(day)
  const affected = getUnderperformingMppts(current, baseline, minimumRatio)
  const minimumPercent = Math.round(minimumRatio * 100)
  const allMppts = mpptPairs(current, baseline)

  await handleDailyCondition(
    'solar-morning',
    day,
    affected.length > 0,
    {
      tone: 'danger',
      title: affected.length === 1 ? `${affected[0]!.name} ผลิตไฟต่ำผิดปกติ` : 'ชุดแผงโซลาร์ผลิตไฟต่ำผิดปกติ',
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

/** รายการ check ที่ควรรันในรอบนี้ ตามเวลาและสถานะออนไลน์ */
function scheduledChecks(clock: { day: string; minuteOfDay: number }, live: Awaited<ReturnType<typeof getLiveSnapshot>>) {
  const { batteryReservePct, batteryEveningMaxPct, minSolarRatio, baselineMonth } = config.energyAlert
  const month = baselineMonth || getDefaultSolarBaselineMonth(clock.day)

  const checks = [{ name: 'device-connection', run: () => checkDeviceConnection(live) }]
  if (!live.isOnline) return checks

  if (clock.minuteOfDay >= MORNING_ALERT_MINUTE) {
    checks.push(
      { name: 'battery-morning', run: () => checkMorningBattery(clock.day, live.batterySoc, batteryReservePct) },
      { name: 'solar-morning', run: () => checkMorningSolar(clock.day, month, minSolarRatio) },
    )
  }
  if (clock.minuteOfDay >= EVENING_ALERT_MINUTE) {
    checks.push({ name: 'battery-evening', run: () => checkEveningBattery(clock.day, live.batterySoc, batteryEveningMaxPct) })
  }

  return checks
}

export const runEnergyAlerts = createAlertWorker<[Date?]>({
  name: 'energy-alerts',
  requiresLineNotice: true,
  run: async (now = new Date()) => {
    const clock = getBangkokClock(now)
    const live = await getLiveSnapshot()
    await runAlertChecks('energy-alerts', scheduledChecks(clock, live))
  },
})
