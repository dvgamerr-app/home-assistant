/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'
import { getBangkokMinuteOfDay } from './date'

describe('getBangkokMinuteOfDay', () => {
  test('แปลงเวลา UTC เป็นนาทีของวันตามเวลา Bangkok', () => {
    expect(getBangkokMinuteOfDay(new Date('2026-10-15T03:30:00Z'))).toBe(10 * 60 + 30)
  })

  test('ข้ามเที่ยงคืนของ Bangkok ได้ถูกต้อง', () => {
    expect(getBangkokMinuteOfDay(new Date('2026-10-14T17:05:00Z'))).toBe(5)
    expect(getBangkokMinuteOfDay(new Date('2026-10-14T16:59:00Z'))).toBe(23 * 60 + 59)
  })
})
