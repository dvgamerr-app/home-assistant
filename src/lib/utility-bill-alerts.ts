import { formatThaiDate, getBangkokISODate } from './date'
import { getBills, getWaterUsage } from './db'
import { getAlertState, setAlertState } from './alert-state'
import { MONTH_LONG_TH } from './electricity'
import { logger } from './logger'
import { sendUtilityBillNotice } from './utility-line-notice'

let running = false
let missingConfigLogged = false

export type UtilityBillType = 'electricity' | 'water'
export type UtilityBillSchedule = {
  electricityDay: number
  waterDay: number
  graceDays: number
}

const integerEnv = (name: string, fallback: number, min: number, max: number) => {
  const value = Number(process.env[name])
  return Number.isFinite(value) ? Math.min(Math.max(Math.trunc(value), min), max) : fallback
}

export function getUtilityBillSchedule(): UtilityBillSchedule {
  return {
    electricityDay: integerEnv('MEA_BILL_DAY', 12, 1, 28),
    waterDay: integerEnv('MWA_BILL_DAY', 22, 1, 28),
    graceDays: integerEnv('UTILITY_ALERT_GRACE_DAYS', 1, 0, 7),
  }
}

export function getScheduledUtilityBillTypes(now = new Date(), schedule = getUtilityBillSchedule()): UtilityBillType[] {
  const day = Number(getBangkokISODate(now).slice(8, 10))
  const withinWindow = (dueDay: number) => day >= dueDay && day <= dueDay + schedule.graceDays

  return [...(withinWindow(schedule.electricityDay) ? (['electricity'] as const) : []), ...(withinWindow(schedule.waterDay) ? (['water'] as const) : [])]
}

const oneDecimal = (value: number) => value.toLocaleString('th-TH', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const amount = (value: number) => value.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function thaiBillingPeriod(year: number, month: number) {
  const monthName = MONTH_LONG_TH[month - 1]
  return monthName ? `${monthName} ${year + 543}` : `${String(month).padStart(2, '0')}/${year}`
}

function electricityBillingPeriod(value: string) {
  const match = /^(\d{4})(\d{2})$/.exec(value)
  return match ? thaiBillingPeriod(Number(match[1]), Number(match[2])) : value
}

async function checkElectricityBill() {
  const [bill] = await getBills(1)
  if (!bill) return

  const identity = bill.billNoNormalized ?? bill.billNo ?? bill.month
  const alertKey = 'electricity-bill'
  const state = await getAlertState(alertKey)
  if (!state) {
    await setAlertState({ alertKey, status: 'seen', lastValue: identity })
    return
  }
  if (state.lastValue === identity) return

  await sendUtilityBillNotice({
    utility: 'electricity',
    period: electricityBillingPeriod(bill.month),
    amount: amount(bill.paid),
    usage: `${oneDecimal(bill.kwh)} kWh`,
    ...(bill.billDate ? { billDate: formatThaiDate(bill.billDate) } : {}),
    ...(bill.dueDate ? { dueDate: formatThaiDate(bill.dueDate) } : {}),
  })
  await setAlertState({ alertKey, status: 'seen', lastValue: identity, notified: true })
}

async function checkWaterBill() {
  const [bill] = await getWaterUsage(1)
  if (!bill) return

  const identity = bill.billNumber || `${bill.year}-${bill.month}`
  const alertKey = 'water-bill'
  const state = await getAlertState(alertKey)
  if (!state) {
    await setAlertState({ alertKey, status: 'seen', lastValue: identity })
    return
  }
  if (state.lastValue === identity) return

  await sendUtilityBillNotice({
    utility: 'water',
    period: thaiBillingPeriod(bill.year, bill.month),
    amount: amount(bill.billedAmount),
    usage: `${oneDecimal(bill.consumption)} m³`,
    ...(bill.billDate ? { billDate: formatThaiDate(bill.billDate) } : {}),
    ...(bill.dueDate ? { dueDate: formatThaiDate(bill.dueDate) } : {}),
  })
  await setAlertState({ alertKey, status: 'seen', lastValue: identity, notified: true })
}

async function runCycle(types: UtilityBillType[]) {
  if (types.length === 0) return

  const noticeUrl = process.env.LINE_NOTICE_URL?.trim()
  const apiKey = process.env.LINE_NOTICE_API_KEY?.trim()
  if (!noticeUrl || !apiKey) {
    if (!missingConfigLogged) logger.warn('Utility bill alerts disabled: LINE_NOTICE_URL or LINE_NOTICE_API_KEY is missing')
    missingConfigLogged = true
    return
  }
  missingConfigLogged = false

  await Promise.all([...(types.includes('electricity') ? [checkElectricityBill()] : []), ...(types.includes('water') ? [checkWaterBill()] : [])])
}

export async function runUtilityBillAlerts(types: UtilityBillType[] = ['electricity', 'water']) {
  if (running) return
  running = true
  try {
    await runCycle(types)
  } catch (err) {
    logger.error({ err }, 'Utility bill alert cycle failed')
  } finally {
    running = false
  }
}
