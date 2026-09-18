/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'
import { probeDelayMs } from './connectivity'

describe('จังหวะ probe หาเซิร์ฟเวอร์', () => {
  test('ต่อได้อยู่ = ตรวจห่าง ๆ พอให้รู้ตัวเร็วโดยไม่กวน', () => {
    expect(probeDelayMs(0)).toBe(30_000)
    expect(probeDelayMs(-1)).toBe(30_000)
  })

  test('พลาดครั้งแรกต้องลองใหม่เร็ว แล้วค่อยถอยทีละขั้น', () => {
    expect(probeDelayMs(1)).toBe(2000)
    expect(probeDelayMs(2)).toBe(4000)
    expect(probeDelayMs(3)).toBe(8000)
    expect(probeDelayMs(4)).toBe(15_000)
  })

  test('เน็ตล่มยาวแล้วหยุดถอยที่ 30 วินาที ไม่ปล่อยให้ห่างขึ้นเรื่อย ๆ', () => {
    expect(probeDelayMs(5)).toBe(30_000)
    expect(probeDelayMs(50)).toBe(30_000)
  })
})
