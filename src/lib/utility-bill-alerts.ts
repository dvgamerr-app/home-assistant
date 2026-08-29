import { createAlertWorker, runAlertChecks } from './alert-worker'
import { config } from './config'
import { formatThaiDate, getBangkokISODate } from './date'
import { getBills, getWaterUsage } from './db'
import { getAlertState, setAlertState } from './alert-state'
import { MONTH_LONG_TH, num } from './electricity'
import { sendUtilityBillNotice } from './utility-line-notice'

export type UtilityBillType = 'electricity' | 'water'
export type UtilityBillSchedule = {
  electricityDay: number
  waterDay: number
  graceDays: number
}

export function getUtilityBillSchedule(): UtilityBillSchedule {
  return config.utilityBill
}

export function getScheduledUtilityBillTypes(now = new Date(), schedule = getUtilityBillSchedule()): UtilityBillType[] {
  const day = Number(getBangkokISODate(now).slice(8, 10))
  const withinWindow = (dueDay: number) => day >= dueDay && day <= dueDay + schedule.graceDays

  return [...(withinWindow(schedule.electricityDay) ? (['electricity'] as const) : []), ...(withinWindow(schedule.waterDay) ? (['water'] as const) : [])]
}

const oneDecimal = (value: number) => num(value, 1)
const amount = (value: number) => num(value, 2)

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

export const runUtilityBillAlerts = createAlertWorker<[UtilityBillType[]?]>({
  name: 'utility-bill-alerts',
  requiresLineNotice: true,
  run: async (types = ['electricity', 'water']) => {
    // เดิมใช้ Promise.all — ถ้าค่าไฟ reject ด้วย ค่าน้ำจะถูกทิ้งเงียบๆ ไม่มี log
    await runAlertChecks('utility-bill-alerts', [
      ...(types.includes('electricity') ? [{ name: 'electricity-bill', run: checkElectricityBill }] : []),
      ...(types.includes('water') ? [{ name: 'water-bill', run: checkWaterBill }] : []),
    ])
  },
})
