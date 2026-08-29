/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'
import { buildMeaBillPayload, buildMwaBillPayload, buildQrImageUrl, decodeQrToken, encodeQrToken } from './bill-qr'
import { verifyPayloadCrc } from './thai-qr'

// payload สมมติในรูปแบบบาร์โค้ดที่มี \r (repo เป็น public — ห้ามใส่เลขบิลจริง)
const PAYLOAD = '|099400000000000\r0123456780\r090000000001\r2634'

describe('signed QR token', () => {
  test('encode แล้ว decode ได้ payload เดิม รวมอักขระ \r', () => {
    expect(decodeQrToken(encodeQrToken(PAYLOAD))).toBe(PAYLOAD)
  })

  test('token ปลอดภัยกับ query string (ไม่มี + / =)', () => {
    const [data] = encodeQrToken(PAYLOAD).split('.')
    expect(data).not.toMatch(/[+/=]/)
  })

  test('แก้ payload ใน token แล้วลายเซ็นต้องไม่ผ่าน', () => {
    const [, sig] = encodeQrToken(PAYLOAD).split('.')
    const forged = `${Buffer.from(PAYLOAD.replace('2634', '9999'), 'utf8').toString('base64url')}.${sig}`
    expect(decodeQrToken(forged)).toBeNull()
  })

  test('ลายเซ็นมั่ว / ไม่มีลายเซ็น ต้องไม่ผ่าน', () => {
    const [data] = encodeQrToken(PAYLOAD).split('.')
    expect(decodeQrToken(`${data}.xxxxxxxx`)).toBeNull()
    expect(decodeQrToken(data!)).toBeNull()
    expect(decodeQrToken('')).toBeNull()
  })

  test('URL รูปเป็น absolute พร้อม token — LINE ต้อง fetch ได้จากภายนอก', () => {
    const url = buildQrImageUrl(PAYLOAD, 'https://home.example.com')
    expect(url.startsWith('https://home.example.com/api/qr/bill.png?t=')).toBe(true)
    expect(decodeQrToken(new URL(url).searchParams.get('t')!)).toBe(PAYLOAD)
  })
})

describe('MEA bill payload', () => {
  // ค่าสมมติ (repo เป็น public — ห้ามใส่เลข CA/บิลจริง)
  const input = { ca: '012345678', billNo: '90000000001', amount: 26.34 }
  const BILLER = '099400000000000'

  test('คืน null เมื่อไม่ได้ตั้ง Biller ID — fail-safe ซ่อน QR', () => {
    // config.biller.mea ว่างใน environment ของ test
    expect(buildMeaBillPayload(input)).toBeNull()
  })

  test('ประกอบ Ref1/Ref2 ตามรูปแบบที่ผ่านการสแกนจริง', () => {
    const payload = buildMeaBillPayload({ ...input, billerId: BILLER })!

    expect(payload).not.toBeNull()
    expect(payload).toContain(`0115${BILLER}`)
    // Ref1 = ca เติม 0 ท้ายครบ 10 หลัก
    expect(payload).toContain('02100123456780')
    // Ref2 = bill_no เติม 0 หน้าครบ 12 หลัก — จำเป็น ตัดออกแล้วสแกนไม่ผ่าน
    expect(payload).toContain('0312090000000001')
    expect(payload).toContain('540526.34')
    expect(verifyPayloadCrc(payload)).toBe(true)
  })

  test('ไม่ใส่วันครบกำหนดใน Ref2 — เหตุผลที่ทำอัตโนมัติจาก DB ได้', () => {
    const payload = buildMeaBillPayload({ ...input, billerId: BILLER })!
    // Ref2 ยาว 12 พอดี ไม่มี 6 หลักวันที่ต่อท้ายแบบที่อยู่บนบิล
    expect(payload).not.toContain('0318')
  })

  test('คืน null เมื่อข้อมูลไม่พอ', () => {
    expect(buildMeaBillPayload({ ...input, ca: '' })).toBeNull()
    expect(buildMeaBillPayload({ ...input, billNo: '' })).toBeNull()
    expect(buildMeaBillPayload({ ...input, amount: 0 })).toBeNull()
    expect(buildMeaBillPayload({ ...input, amount: -1 })).toBeNull()
  })

  test('คืน null เมื่อ ca/bill_no ยาวเกินรูปแบบที่ยืนยันไว้ — ไม่เดาต่อ', () => {
    expect(buildMeaBillPayload({ ...input, ca: '12345678901' })).toBeNull()
    expect(buildMeaBillPayload({ ...input, billNo: '1234567890123' })).toBeNull()
  })
})

describe('MWA bill payload', () => {
  const input = { accountCode: '0011223344', billNumber: '900002', amount: 137.82 }
  const BILLER = '099400000000001'

  test('Ref1 = account_code, Ref2 = bill_number เติม 0 หน้าครบ 12', () => {
    const payload = buildMwaBillPayload({ ...input, billerId: BILLER })!

    expect(payload).toContain(`0115${BILLER}`)
    expect(payload).toContain('02100011223344')
    expect(payload).toContain('0312000000900002')
    expect(payload).toContain('5406137.82')
    expect(verifyPayloadCrc(payload)).toBe(true)
  })

  test('คืน null เมื่อไม่ได้ตั้ง Biller ID', () => {
    expect(buildMwaBillPayload(input)).toBeNull()
  })

  test('account_code ต้องยาว 10 พอดี — สั้นกว่าไม่เดาว่าเติมหน้าหรือท้าย', () => {
    expect(buildMwaBillPayload({ ...input, accountCode: '123', billerId: BILLER })).toBeNull()
    expect(buildMwaBillPayload({ ...input, accountCode: '00112233445', billerId: BILLER })).toBeNull()
  })

  test('คืน null เมื่อยอดไม่ถูกต้อง', () => {
    expect(buildMwaBillPayload({ ...input, amount: 0, billerId: BILLER })).toBeNull()
    expect(buildMwaBillPayload({ ...input, amount: -1, billerId: BILLER })).toBeNull()
  })

  test('MEA เติม 0 ท้าย / MWA ไม่เติม — กติกาต่างกันตรงนี้เท่านั้น', () => {
    const mea = buildMeaBillPayload({ ca: '012345678', billNo: '900002', amount: 1, billerId: BILLER })!
    expect(mea).toContain('02100123456780')
  })
})
