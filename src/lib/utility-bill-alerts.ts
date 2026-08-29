import { createAlertWorker, runAlertChecks } from './alert-worker'
import { buildMeaBillPayload, buildMwaBillPayload, buildQrImageUrl } from './bill-qr'
import { config } from './config'
import { formatThaiDate } from './date'
import { getBills, getWaterUsage } from './db'
import { getAlertState, setAlertState } from './alert-state'
import { MONTH_LONG_TH, num } from './electricity'
import { sendUtilityBillNotice } from './utility-line-notice'

export type UtilityBillType = 'electricity' | 'water'

/**
 * ตัดสินว่าควรแจ้งบิลใบนี้หรือยัง โดยดูจาก "เลขบิล" ไม่ใช่วันที่
 *
 * collector ดึงบิล MEA/MWA ใหม่ทุกวัน 09:00 (cron `0 9 * * *`) ดังนั้นบิลใบใหม่
 * โผล่วันไหนก็ได้ ตรรกะเดิมที่กรองตาม MEA_BILL_DAY/MWA_BILL_DAY จึงพลาดบิล
 * ที่มาไม่ตรงวัน แล้วไปโผล่ตอน container restart แทน
 *
 * การเทียบด้วยเลขบิลทำให้เรียกซ้ำกี่รอบก็ปลอดภัย — ส่งแค่ตอนเลขบิลเปลี่ยนจริง
 */
export function shouldNotifyBill(state: { lastValue: string | null } | null, identity: string) {
  // ครั้งแรกสุด: จดไว้เฉยๆ ไม่แจ้ง กันสแปมตอนตั้งระบบใหม่
  if (!state) return 'record-only' as const
  return state.lastValue === identity ? ('none' as const) : ('notify' as const)
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
  const decision = shouldNotifyBill(await getAlertState(alertKey), identity)
  if (decision === 'none') return
  if (decision === 'record-only') {
    await setAlertState({ alertKey, status: 'seen', lastValue: identity })
    return
  }

  const qrPayload = buildMeaBillPayload({ ca: bill.ca, billNo: bill.billNo ?? '', amount: bill.paid })

  await sendUtilityBillNotice({
    utility: 'electricity',
    period: electricityBillingPeriod(bill.month),
    amount: amount(bill.paid),
    usage: `${oneDecimal(bill.kwh)} kWh`,
    ...(bill.billDate ? { billDate: formatThaiDate(bill.billDate) } : {}),
    ...(bill.dueDate ? { dueDate: formatThaiDate(bill.dueDate) } : {}),
    ...(qrPayload ? { qrImageUrl: buildQrImageUrl(qrPayload, config.appBaseUrl) } : {}),
  })
  await setAlertState({ alertKey, status: 'seen', lastValue: identity, notified: true })
}

async function checkWaterBill() {
  const [bill] = await getWaterUsage(1)
  if (!bill) return

  const identity = bill.billNumber || `${bill.year}-${bill.month}`
  const alertKey = 'water-bill'
  const decision = shouldNotifyBill(await getAlertState(alertKey), identity)
  if (decision === 'none') return
  if (decision === 'record-only') {
    await setAlertState({ alertKey, status: 'seen', lastValue: identity })
    return
  }

  // เอา account_code จากแถวข้อมูลตรงๆ ไม่พึ่ง env (MWA_ACCOUNT_CODE อาจไม่ได้ตั้ง
  // และ query ก็ fallback ไปบัญชีแรกอยู่แล้ว — ต้องใช้เลขของบิลใบที่แจ้งจริง)
  const qrPayload = buildMwaBillPayload({ accountCode: bill.accountCode, billNumber: bill.billNumber, amount: bill.billedAmount })

  await sendUtilityBillNotice({
    utility: 'water',
    period: thaiBillingPeriod(bill.year, bill.month),
    amount: amount(bill.billedAmount),
    usage: `${oneDecimal(bill.consumption)} m³`,
    ...(bill.billDate ? { billDate: formatThaiDate(bill.billDate) } : {}),
    ...(bill.dueDate ? { dueDate: formatThaiDate(bill.dueDate) } : {}),
    ...(qrPayload ? { qrImageUrl: buildQrImageUrl(qrPayload, config.appBaseUrl) } : {}),
  })
  await setAlertState({ alertKey, status: 'seen', lastValue: identity, notified: true })
}

/**
 * เช็คบิลทั้งสองทุกรอบ ไม่กรองตามวันที่ — dedupe ด้วยเลขบิลใน shouldNotifyBill()
 * ทำให้ปลอดภัยที่จะเรียกบ่อย และบิลจะถูกแจ้งภายใน 1 รอบ poll หลัง collector ดึงมา
 */
export const runUtilityBillAlerts = createAlertWorker({
  name: 'utility-bill-alerts',
  requiresLineNotice: true,
  run: async () => {
    // runAlertChecks ไม่ใช่ Promise.all — ถ้าค่าไฟ reject ค่าน้ำต้องยังได้เช็คและมี log
    await runAlertChecks('utility-bill-alerts', [
      { name: 'electricity-bill', run: checkElectricityBill },
      { name: 'water-bill', run: checkWaterBill },
    ])
  },
})
