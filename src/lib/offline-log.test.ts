/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'
import { bangkokDayStart, HOUR_MS, MINUTE_MS } from './chart-viewport'
import { currentOutageSec, emptyOutageLog, formatOutageDuration, markOutageEnd, markOutageStart, outageSecToday, parseOutageLog, rollOutageLog, serializeOutageLog } from './offline-log'

describe('บันทึกช่วงเน็ตหลุดฝั่งเบราว์เซอร์', () => {
  const day = bangkokDayStart('2026-09-18')
  const at = (hours: number, minutes = 0) => day + hours * HOUR_MS + minutes * MINUTE_MS

  test('เริ่มจากยอดศูนย์ของวันตามเวลาไทย', () => {
    const log = emptyOutageLog(at(9))
    expect(log).toEqual({ date: '2026-09-18', downSec: 0, openedAt: null })
    expect(outageSecToday(log, at(9))).toBe(0)
  })

  test('ปิดช่วงหลุดแล้วบวกเข้ายอดของวัน', () => {
    let log = emptyOutageLog(at(9))
    log = markOutageStart(log, at(9, 10))
    log = markOutageEnd(log, at(9, 30))
    expect(log.openedAt).toBeNull()
    expect(log.downSec).toBe(20 * 60)
    expect(outageSecToday(log, at(12))).toBe(20 * 60)
  })

  test('เรียก markOutageStart ซ้ำระหว่างที่ยังหลุดอยู่ ไม่รีเซ็ตเวลาเริ่ม', () => {
    let log = markOutageStart(emptyOutageLog(at(9)), at(9, 10))
    log = markOutageStart(log, at(9, 25))
    expect(log.openedAt).toBe(at(9, 10))
    expect(currentOutageSec(log, at(9, 40))).toBe(30 * 60)
  })

  test('markOutageEnd ตอนที่ออนไลน์อยู่แล้วไม่เปลี่ยนอะไร', () => {
    const log = emptyOutageLog(at(9))
    expect(markOutageEnd(log, at(10))).toEqual(log)
  })

  test('ยอดรวมของวันนับช่วงที่ยังหลุดค้างอยู่ด้วย', () => {
    let log = markOutageStart(emptyOutageLog(at(1)), at(1))
    log = markOutageEnd(log, at(1, 15))
    log = markOutageStart(log, at(20))
    expect(outageSecToday(log, at(20, 5))).toBe(20 * 60)
    expect(currentOutageSec(log, at(20, 5))).toBe(5 * 60)
  })

  test('ข้ามวันแล้วตัดยอดใหม่ · ช่วงที่ยังหลุดอยู่นับต่อจากเที่ยงคืน', () => {
    let log = markOutageStart(emptyOutageLog(at(22)), at(23))
    log = rollOutageLog(log, bangkokDayStart('2026-09-19') + 30 * MINUTE_MS)
    expect(log.date).toBe('2026-09-19')
    expect(log.downSec).toBe(0)
    expect(log.openedAt).toBe(bangkokDayStart('2026-09-19'))
    expect(outageSecToday(log, bangkokDayStart('2026-09-19') + 30 * MINUTE_MS)).toBe(30 * 60)
  })

  test('ข้ามวันตอนออนไลน์อยู่ ไม่เปิดช่วงหลุดขึ้นมาเอง', () => {
    const log = rollOutageLog(emptyOutageLog(at(22)), bangkokDayStart('2026-09-19'))
    expect(log).toEqual({ date: '2026-09-19', downSec: 0, openedAt: null })
  })

  test('อ่านค่าที่พังจาก localStorage แล้วเริ่มนับใหม่แทนที่จะโยน error', () => {
    const fresh = { date: '2026-09-18', downSec: 0, openedAt: null }
    expect(parseOutageLog(null, at(9))).toEqual(fresh)
    expect(parseOutageLog('ไม่ใช่ json', at(9))).toEqual(fresh)
    expect(parseOutageLog('[]', at(9))).toEqual(fresh)
    expect(parseOutageLog('{"date":"เมื่อวาน","downSec":5,"openedAt":null}', at(9))).toEqual(fresh)
    expect(parseOutageLog('{"date":"2026-09-18","downSec":-5,"openedAt":null}', at(9))).toEqual(fresh)
    expect(parseOutageLog('{"date":"2026-09-18","downSec":10,"openedAt":"เมื่อกี้"}', at(9))).toEqual(fresh)
  })

  test('บันทึก/อ่านกลับได้ค่าเดิม และตัดยอดให้เองถ้าข้ามวันมาแล้ว', () => {
    const log = markOutageEnd(markOutageStart(emptyOutageLog(at(9)), at(9)), at(9, 5))
    expect(parseOutageLog(serializeOutageLog(log), at(10))).toEqual(log)
    expect(parseOutageLog(serializeOutageLog(log), bangkokDayStart('2026-09-20'))).toEqual({ date: '2026-09-20', downSec: 0, openedAt: null })
  })

  test('จัดรูปเวลาให้อ่านง่ายตามช่วง', () => {
    expect(formatOutageDuration(0)).toBe('0 วินาที')
    expect(formatOutageDuration(45)).toBe('45 วินาที')
    expect(formatOutageDuration(20 * 60)).toBe('20 นาที')
    expect(formatOutageDuration(90 * 60)).toBe('1.5 ชม.')
  })
})
