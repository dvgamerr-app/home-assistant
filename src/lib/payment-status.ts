// จัดหมวดสถานะการชำระบิลค่าไฟ (MEA) และค่าน้ำ (MWA) ให้เป็นชุดเดียว
// เพื่อไม่ให้หน้า index / bill / water ตีความ payment_status ต่างกัน

/** โทนสีตาม design token — ใช้ร่วมกันทุกหน้า */
const TONE = {
  paid: 'text-chart-1',
  warn: 'text-chart-2',
  late: 'text-chart-4',
  neutral: 'text-muted-foreground',
} as const

export type PaymentKind = 'paid' | 'partial' | 'overdue' | 'pending' | 'unmapped' | 'unknown'

export interface PaymentState {
  kind: PaymentKind
  /** ป้ายภาษาไทยพร้อมแสดง */
  label: string
  /** class สีตาม design token */
  tone: string
  /** true = ยังต้องตามตรวจกับต้นทาง */
  needsReview: boolean
}

/** field ที่ต้องใช้ตัดสินสถานะบิล MEA (subset ของ ElectricBill) */
export interface MeaPaymentFields {
  paymentStatus: string | null
  paymentAmount: number | null
  outstandingAmount: number | null
}

/** field ที่ต้องใช้ตัดสินสถานะบิล MWA (subset ของ WaterBill) */
export interface MwaPaymentFields {
  isPaid: boolean
  paidAmount: number
  remainingAmount: number
}

const PAID = new Set(['paid'])
const PARTIAL = new Set(['partial', 'partially_paid'])
const OVERDUE = new Set(['overdue', 'late'])
const PENDING = new Set(['pending', 'unpaid', 'outstanding'])

/**
 * ตีความ `stash.mea_electric.payment_status` ที่ collector ส่งมา
 *
 * `unmapped` = collector ส่งสถานะใหม่ที่ยังไม่มีคำแปล (แสดงค่าดิบไว้ให้เห็น)
 * `unknown`  = ไม่มีสถานะเลย และยอดก็ไม่บอกอะไร
 */
export function classifyMeaPayment(bill: MeaPaymentFields): PaymentState {
  const status = bill.paymentStatus?.trim().toLowerCase() ?? ''

  if (PAID.has(status)) return { kind: 'paid', label: 'ชำระแล้ว', tone: TONE.paid, needsReview: false }

  const hasPartialAmounts = (bill.paymentAmount ?? 0) > 0 && (bill.outstandingAmount ?? 0) > 0
  if (PARTIAL.has(status) || hasPartialAmounts) return { kind: 'partial', label: 'ชำระบางส่วน', tone: TONE.warn, needsReview: true }

  if (OVERDUE.has(status)) return { kind: 'overdue', label: 'เกินกำหนด', tone: TONE.late, needsReview: true }
  if (PENDING.has(status)) return { kind: 'pending', label: 'รอชำระ', tone: TONE.late, needsReview: true }

  if (status) return { kind: 'unmapped', label: bill.paymentStatus ?? status, tone: TONE.neutral, needsReview: true }
  return { kind: 'unknown', label: 'ยังไม่พบหลักฐานชำระ', tone: TONE.warn, needsReview: true }
}

/**
 * ตีความสถานะบิลน้ำ — MWA ไม่มีคอลัมน์สถานะ ต้องอนุมานจากยอดที่ชำระ/คงเหลือ
 * (`isPaid` คำนวณไว้แล้วใน `src/lib/db.ts`)
 */
export function classifyMwaPayment(bill: MwaPaymentFields): PaymentState {
  if (bill.isPaid) return { kind: 'paid', label: 'ชำระแล้ว', tone: TONE.paid, needsReview: false }
  if (bill.paidAmount > 0 && bill.remainingAmount > 0) return { kind: 'partial', label: 'ชำระบางส่วน', tone: TONE.warn, needsReview: true }
  return { kind: 'pending', label: 'รอชำระ', tone: TONE.late, needsReview: true }
}
