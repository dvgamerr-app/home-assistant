// สร้าง payload ของ QR จ่ายบิลข้ามธนาคาร (Thai QR Payment)
//
// มาตรฐาน: EMVCo Merchant-Presented Mode QR v1.1 + Bank of Thailand supplement
// โครงสร้างเป็น TLV (ID 2 หลัก + Length 2 หลัก + Value) เรียง tag จากน้อยไปมาก
// และปิดท้ายด้วย CRC ที่คำนวณคลุมทั้ง payload รวม prefix "6304" ของตัวมันเอง
//
// ⚠️ Biller ID ต้องมาจากบาร์โค้ดบนบิลจริงเท่านั้น ห้ามเดา — ถ้าผิด เงินวิ่งไปผู้รับอื่น
//
// รูปแบบบาร์โค้ดบนบิลไทย (ใช้อ่าน Biller ID ครั้งเดียวตอนตั้งค่า):
//   |<BillerID> <Ref1> <Ref2> <ยอดเป็นสตางค์>
// ยอดในบาร์โค้ดเป็นสตางค์ ไม่มีจุดทศนิยม เช่น `2634` = 26.34 บาท

/** AID สำหรับจ่ายบิลข้ามธนาคารภายในประเทศ */
export const BILL_PAYMENT_AID = 'A000000677010112'

const CURRENCY_THB = '764'
const COUNTRY_TH = 'TH'

/** 11 = QR ใช้ซ้ำได้ (ไม่ระบุยอด) · 12 = QR ครั้งเดียว (ระบุยอด) */
const POINT_OF_INITIATION = { static: '11', dynamic: '12' } as const

/** EMVCo TLV: ID 2 หลัก + ความยาว 2 หลัก + ค่า */
export function tlv(id: string, value: string) {
  if (value.length > 99) throw new Error(`TLV ${id} ยาวเกิน 99 อักขระ (${value.length})`)
  return `${id}${String(value.length).padStart(2, '0')}${value}`
}

/**
 * CRC-16/CCITT-FALSE — poly 0x1021, init 0xFFFF, ไม่ reflect, ไม่ xor ตอนออก
 * (ชื่ออื่นในตำรา: CRC-16/IBM-3740) ค่าตรวจมาตรฐานของ "123456789" คือ 0x29B1
 */
export function crc16Ccitt(input: string) {
  let crc = 0xffff
  for (let i = 0; i < input.length; i++) {
    crc ^= input.charCodeAt(i) << 8
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
    }
  }
  return crc
}

/** CRC เป็น hex ตัวใหญ่ 4 หลัก ตามที่สเปกกำหนด */
export const crcHex = (input: string) => crc16Ccitt(input).toString(16).toUpperCase().padStart(4, '0')

export type BillPaymentInput = {
  /** Biller ID 13 หรือ 15 หลัก (เลขผู้เสียภาษี 13 หลัก + suffix 2 หลัก) */
  billerId: string
  ref1: string
  ref2?: string
  /** ยอดเงินเป็นบาท — ไม่ใส่ = ให้ผู้จ่ายกรอกเอง */
  amount?: number
}

/** จัดรูปยอดเงิน: ทศนิยม 2 ตำแหน่ง ไม่มีตัวคั่นหลักพัน */
function formatAmount(amount: number) {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error(`ยอดเงินไม่ถูกต้อง: ${amount}`)
  return amount.toFixed(2)
}

function assertDigits(label: string, value: string) {
  if (!/^\d+$/.test(value)) throw new Error(`${label} ต้องเป็นตัวเลขล้วน: ${JSON.stringify(value)}`)
}

/**
 * คืน payload string ที่เอาไป render เป็น QR ได้ตรงๆ
 *
 * @example
 * buildBillPaymentPayload({ billerId: '310110000000000', ref1: '0161234555', amount: 1169.52 })
 */
export function buildBillPaymentPayload({ billerId, ref1, ref2, amount }: BillPaymentInput) {
  assertDigits('Biller ID', billerId)
  if (billerId.length !== 13 && billerId.length !== 15) throw new Error(`Biller ID ต้องยาว 13 หรือ 15 หลัก (ได้ ${billerId.length})`)
  if (!ref1) throw new Error('ต้องมี Ref1')

  const merchant = [tlv('00', BILL_PAYMENT_AID), tlv('01', billerId), tlv('02', ref1), ...(ref2 ? [tlv('03', ref2)] : [])].join('')

  // เรียง tag จากน้อยไปมากตาม EMVCo (00 → 01 → 30 → 53 → 54 → 58 → 63)
  //
  // หมายเหตุ: payload จริงบางตัวในไทย (เช่นที่ dtinth/promptpay-qr สร้าง) วาง 58
  // ไว้ก่อน 53 ซึ่งก็สแกนได้ เพราะ parser ฝั่งธนาคารอ่านตาม tag ไม่ใช่ตามลำดับ
  // ถ้าเจอแอปธนาคารที่สแกนไม่ผ่าน ให้ลองสลับ 58 ขึ้นมาก่อน 53 เป็นอย่างแรก
  const body = [
    tlv('00', '01'),
    tlv('01', amount === undefined ? POINT_OF_INITIATION.static : POINT_OF_INITIATION.dynamic),
    tlv('30', merchant),
    tlv('53', CURRENCY_THB),
    ...(amount === undefined ? [] : [tlv('54', formatAmount(amount))]),
    tlv('58', COUNTRY_TH),
  ].join('')

  // CRC คลุม body + "6304" ของตัวเอง
  const withCrcPrefix = `${body}6304`
  return `${withCrcPrefix}${crcHex(withCrcPrefix)}`
}

/** ตรวจว่า payload ที่ได้มา (เช่นจากการสแกน) CRC ถูกต้องไหม */
export function verifyPayloadCrc(payload: string) {
  if (payload.length < 8) return false
  const body = payload.slice(0, -4)
  if (!body.endsWith('6304')) return false
  return payload.slice(-4).toUpperCase() === crcHex(body)
}
