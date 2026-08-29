/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'
import { BILL_PAYMENT_AID, buildBillPaymentPayload, crc16Ccitt, crcHex, tlv, verifyPayloadCrc } from './thai-qr'

describe('CRC-16/CCITT-FALSE', () => {
  // ค่าตรวจมาตรฐานจาก CRC catalogue — ถ้า test นี้แดง แปลว่า algorithm ผิด
  test('ค่าตรวจของ "123456789" = 0x29B1', () => {
    expect(crc16Ccitt('123456789')).toBe(0x29b1)
    expect(crcHex('123456789')).toBe('29B1')
  })

  test('input ว่าง = init value 0xFFFF', () => {
    expect(crc16Ccitt('')).toBe(0xffff)
  })

  test('hex เติมศูนย์ครบ 4 หลักเสมอ', () => {
    expect(crcHex('123456789')).toHaveLength(4)
  })
})

describe('EMVCo TLV', () => {
  test('เติมความยาวเป็น 2 หลัก', () => {
    expect(tlv('00', '01')).toBe('000201')
    expect(tlv('01', 'A'.repeat(9))).toBe(`0109${'A'.repeat(9)}`)
    expect(tlv('30', 'B'.repeat(12))).toBe(`3012${'B'.repeat(12)}`)
  })

  test('ค่ายาวเกิน 99 = error ไม่ใช่ปล่อยผ่านให้ QR เสีย', () => {
    expect(() => tlv('02', 'x'.repeat(100))).toThrow(/ยาวเกิน 99/)
  })
})

describe('Bill payment payload', () => {
  // ตัวเลขสมมติทั้งหมด ไม่ใช่ Biller ID จริงของหน่วยงานใด
  const input = { billerId: '310110000000000', ref1: '0161234555', ref2: '202607', amount: 1169.52 }

  test('ประกอบ tag ครบตามสเปกและเรียงจากน้อยไปมาก', () => {
    const payload = buildBillPaymentPayload(input)

    expect(payload.startsWith('000201')).toBe(true)
    expect(payload).toContain(`0016${BILL_PAYMENT_AID}`)
    expect(payload).toContain('0115310110000000000')
    expect(payload).toContain('02100161234555')
    expect(payload).toContain('0306202607')
    expect(payload).toContain('5303764')
    expect(payload).toContain('54071169.52')
    expect(payload).toContain('5802TH')
  })

  test('CRC ที่สร้างเองต้อง verify ผ่าน', () => {
    expect(verifyPayloadCrc(buildBillPaymentPayload(input))).toBe(true)
  })

  test('แก้ payload แม้ตัวเดียว CRC ต้องไม่ผ่าน', () => {
    const payload = buildBillPaymentPayload(input)
    const tampered = payload.replace('54071169.52', '54079169.52')
    expect(tampered).not.toBe(payload)
    expect(verifyPayloadCrc(tampered)).toBe(false)
  })

  test('มียอด = dynamic (01=12), ไม่มียอด = static (01=11) และไม่มี tag 54', () => {
    expect(buildBillPaymentPayload(input)).toContain('010212')

    const noAmount = buildBillPaymentPayload({ billerId: input.billerId, ref1: input.ref1 })
    expect(noAmount).toContain('010211')
    expect(noAmount).not.toContain('5407')
    expect(verifyPayloadCrc(noAmount)).toBe(true)
  })

  test('ไม่มี Ref2 = ไม่ใส่ tag 03', () => {
    const payload = buildBillPaymentPayload({ billerId: input.billerId, ref1: input.ref1, amount: 10 })
    expect(payload).not.toContain('0306')
    expect(verifyPayloadCrc(payload)).toBe(true)
  })

  test('ยอดจัดรูปทศนิยม 2 ตำแหน่งเสมอ ไม่มีตัวคั่นหลักพัน', () => {
    expect(buildBillPaymentPayload({ ...input, amount: 1000 })).toContain('54071000.00')
    expect(buildBillPaymentPayload({ ...input, amount: 5 })).toContain('54045.00')
  })

  test('ปฏิเสธ Biller ID ที่ความยาวผิด — กันเงินวิ่งไปผู้รับอื่น', () => {
    expect(() => buildBillPaymentPayload({ ...input, billerId: '12345' })).toThrow(/13 หรือ 15 หลัก/)
    expect(() => buildBillPaymentPayload({ ...input, billerId: '3101100000000' })).not.toThrow()
  })

  test('ปฏิเสธ Biller ID ที่ไม่ใช่ตัวเลข', () => {
    expect(() => buildBillPaymentPayload({ ...input, billerId: '31011000000000X' })).toThrow(/ตัวเลขล้วน/)
  })

  test('ปฏิเสธยอดเงินที่เป็นศูนย์หรือติดลบ', () => {
    expect(() => buildBillPaymentPayload({ ...input, amount: 0 })).toThrow(/ยอดเงินไม่ถูกต้อง/)
    expect(() => buildBillPaymentPayload({ ...input, amount: -5 })).toThrow(/ยอดเงินไม่ถูกต้อง/)
  })

  test('ปฏิเสธ Ref1 ว่าง', () => {
    expect(() => buildBillPaymentPayload({ ...input, ref1: '' })).toThrow(/Ref1/)
  })
})

// ตรวจ CRC ข้ามไปกับ payload จริงที่เผยแพร่โดย dtinth/promptpay-qr
// เป็น PromptPay (tag 29) ไม่ใช่ bill payment (tag 30) แต่ CRC กับกรอบ payload
// เป็นตัวเดียวกัน → ยืนยันได้ว่า algorithm เราตรงกับของที่ใช้งานจริง
describe('CRC cross-check กับ payload จริงจากภายนอก', () => {
  test('PromptPay เบอร์โทร ไม่ระบุยอด', () => {
    const payload = '00020101021129370016A000000677010111011300668999999995802TH53037646304FE29'
    expect(verifyPayloadCrc(payload)).toBe(true)
  })

  test('PromptPay ระบุยอด 420.00', () => {
    const payload = '00020101021229370016A000000677010111011300668999999995802TH53037645406420.006304CF9E'
    expect(verifyPayloadCrc(payload)).toBe(true)
  })

  test('payload จริงที่ถูกแก้ตัวเลข ต้องตรวจไม่ผ่าน', () => {
    const payload = '00020101021229370016A000000677010111011300668999999995802TH53037645406420.006304CF9E'
    expect(verifyPayloadCrc(payload.replace('420.00', '999.00'))).toBe(false)
  })
})
