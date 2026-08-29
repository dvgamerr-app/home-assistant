// เครื่องมือสำหรับ QR จ่ายบิลในการ์ด LINE
//
// รูปแบบ Ref ทั้งหมดมาจากการถอด QR บนบิลจริงด้วยโปรแกรม แล้ว **ทดสอบสแกน
// ด้วยแอปธนาคารจริง** ไม่ใช่การเดา — ตารางผลทดสอบอยู่ใน docs/bill-qr.md
//
// ทั้งสองเจ้าใช้กติกาเดียวกัน: Ref1 = เลขบัญชี/มิเตอร์, Ref2 = เลขบิล
// **ไม่ต้องมีวันครบกำหนด** ทั้งที่บาร์โค้ดบนบิลใส่มาด้วย — พิสูจน์ด้วยการสแกนแล้ว
// ตัวเลขที่ห่อ Ref ในบาร์โค้ดของ MWA (`2`…`4`) เป็นเรื่องของบาร์โค้ดเท่านั้น

import { createHmac, timingSafeEqual } from 'node:crypto'
import { config } from './config'
import { buildBillPaymentPayload } from './thai-qr'

/** ความยาวคงที่ของ Ref ตามที่ปรากฏใน QR บนบิล */
const REF1_LENGTH = 10
const REF2_LENGTH = 12

export type MeaBillQrInput = {
  /** `mea_electric.ca` */
  ca: string
  /** `mea_electric.bill_no` */
  billNo: string
  /** ยอดเป็นบาท (`mea_electric.paid`) */
  amount: number
  /** override Biller ID (ปกติมาจาก config) — ใส่เพื่อทดสอบ */
  billerId?: string
}

const digitsOnly = (value: string) => value.replace(/\D/g, '')

/**
 * QR จ่ายค่าไฟ (EMVCo tag 30) — ยืนยันด้วยการสแกนจริงแล้ว
 *
 * Ref1 = ca เติม 0 ท้ายให้ครบ 10 หลัก
 * Ref2 = bill_no เติม 0 หน้าให้ครบ 12 หลัก (**จำเป็น** ตัดออกแล้วสแกนไม่ผ่าน
 *        แต่ไม่ต้องมีวันครบกำหนด ซึ่งเป็นเหตุผลที่ทำอัตโนมัติจาก DB ได้)
 *
 * @returns null เมื่อข้อมูลไม่พอหรือไม่ได้ตั้ง Biller ID → ฝั่งเรียกจะซ่อน QR
 */
export function buildMeaBillPayload({ ca, billNo, amount, billerId = config.biller.mea }: MeaBillQrInput) {
  // ca ของ MEA ยาว 9 หลัก → เติม 0 **ท้าย** ให้ครบ 10 ตามที่เห็นใน QR บนบิล
  return buildBillQr({ billerId, account: ca, billNo, amount, padAccount: 'end' })
}

export type MwaBillQrInput = {
  /** `mwa_water.account_code` (10 หลัก) */
  accountCode: string
  /** `mwa_water.bill_number` */
  billNumber: string
  /** ยอดเป็นบาท (`mwa_water.gross_amount`) */
  amount: number
  billerId?: string
}

/**
 * QR จ่ายค่าน้ำ (EMVCo tag 30) — ยืนยันด้วยการสแกนจริงแล้ว
 *
 * กติกาเดียวกับค่าไฟ: Ref1 = account_code, Ref2 = bill_number เติม 0 หน้าครบ 12
 *
 * บาร์โค้ดบนบิลยัด account_code + bill_number รวมในฟิลด์เดียวและห่อด้วย `2`…`4`
 * พร้อมวันครบกำหนด แต่พิสูจน์แล้วว่า EMVCo ไม่ต้องใช้ส่วนพวกนั้น
 *
 * account_code ยาว 10 พอดีอยู่แล้ว จึงไม่เติม — ถ้าสั้นกว่าจะคืน null
 * เพราะยังไม่รู้ว่าต้องเติมหน้าหรือท้าย (ไม่เดาเรื่องเงิน)
 */
export function buildMwaBillPayload({ accountCode, billNumber, amount, billerId = config.biller.mwa }: MwaBillQrInput) {
  return buildBillQr({ billerId, account: accountCode, billNo: billNumber, amount, padAccount: 'none' })
}

/** ตรรกะร่วมของทั้งสองเจ้า — ต่างกันแค่วิธีจัดความยาว Ref1 */
function buildBillQr({ billerId, account, billNo, amount, padAccount }: { billerId: string; account: string; billNo: string; amount: number; padAccount: 'end' | 'none' }) {
  const accountDigits = digitsOnly(account)
  const billNoDigits = digitsOnly(billNo)
  if (!billerId || !accountDigits || !billNoDigits || amount <= 0) return null

  // ความยาวไม่เข้ารูปแบบที่ยืนยันไว้ = ไม่เดาต่อ ปล่อยให้ซ่อน QR ดีกว่าสร้างผิด
  if (accountDigits.length > REF1_LENGTH || billNoDigits.length > REF2_LENGTH) return null
  if (padAccount === 'none' && accountDigits.length !== REF1_LENGTH) return null

  try {
    return buildBillPaymentPayload({
      billerId,
      ref1: padAccount === 'end' ? accountDigits.padEnd(REF1_LENGTH, '0') : accountDigits,
      ref2: billNoDigits.padStart(REF2_LENGTH, '0'),
      amount,
    })
  } catch {
    return null
  }
}

// ── URL รูป QR แบบ signed ────────────────────────────────────────────────────
// LINE ต้อง fetch รูปจากภายนอกได้ แต่ middleware บล็อกทุก path
// จึงเปิด /api/qr/bill.png เป็น public แล้วกันการเดา/ปลอมด้วย HMAC
// (payload อยู่ในตัว token ไม่ต้องแตะ DB และไม่เปิดช่องให้ enumerate เลขบิล)

const base64url = (input: Buffer) => input.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')

const sign = (data: string) => base64url(createHmac('sha256', config.qrSignSecret).update(data).digest()).slice(0, 32)

/** encode payload + ลายเซ็นเป็น token เดียวสำหรับใส่ใน query string */
export function encodeQrToken(payload: string) {
  const data = base64url(Buffer.from(payload, 'utf8'))
  return `${data}.${sign(data)}`
}

/** คืน payload เมื่อลายเซ็นถูกต้อง, null เมื่อไม่ถูก */
export function decodeQrToken(token: string) {
  const [data, signature] = token.split('.')
  if (!data || !signature) return null

  const expected = sign(data)
  const a = Buffer.from(signature)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null

  return Buffer.from(data.replaceAll('-', '+').replaceAll('_', '/'), 'base64').toString('utf8')
}

/** URL รูป QR ที่ LINE เอาไปแสดงได้ (ต้องเป็น absolute https) */
export function buildQrImageUrl(payload: string, baseUrl: string) {
  return new URL(`/api/qr/bill.png?t=${encodeQrToken(payload)}`, baseUrl).toString()
}
