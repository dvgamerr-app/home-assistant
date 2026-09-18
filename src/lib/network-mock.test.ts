import { describe, expect, test } from 'bun:test'
import { getNetworkSnapshot } from './network-mock'
import { splitSeriesPaths, svgPathFromPoints, svgStackedBars } from './chart'

const snapshot = getNetworkSnapshot(new Date('2026-09-17T12:00:00+07:00'))

describe('network mock', () => {
  test('ทุก hop มีตัวเลขที่เป็นจำนวนจริง ไม่มี NaN หลุดไปถึง UI', () => {
    expect(snapshot.hops).toHaveLength(4)
    for (const hop of snapshot.hops) {
      for (const value of [hop.latencyMs, hop.avgMs, hop.p95Ms, hop.maxMs, hop.jitterMs, hop.lossPct]) {
        expect(Number.isFinite(value)).toBe(true)
      }
      expect(hop.avgMs).toBeGreaterThan(0)
      expect(hop.p95Ms).toBeGreaterThanOrEqual(hop.avgMs)
      expect(hop.maxMs).toBeGreaterThanOrEqual(hop.p95Ms)
      expect(hop.spark).toHaveLength(144)
    }
  })

  test('เราเตอร์ในบ้านไม่ควรหลุดตอนอินเทอร์เน็ตล่ม — ใช้แยกว่าปัญหาอยู่ในบ้านหรือฝั่งผู้ให้บริการ', () => {
    const local = snapshot.hops.find((hop) => hop.id === 'local')!
    const wan = snapshot.hops.find((hop) => hop.id === 'wan')!
    expect(local.lossPct).toBe(0)
    expect(wan.lossPct).toBeGreaterThan(0)
  })

  test('uptime กับเวลาที่เน็ตหลุดสอดคล้องกัน', () => {
    expect(snapshot.overview.downSecToday).toBeGreaterThan(0)
    expect(snapshot.overview.uptimePctToday).toBeLessThan(100)
    expect(snapshot.overview.uptimePctToday).toBeGreaterThan(98)
    expect(snapshot.hourly).toHaveLength(24)
    expect(snapshot.hourly.reduce((sum, item) => sum + item.downSec, 0)).toBe(snapshot.overview.downSecToday)
  })

  test('กราฟเส้นแตก path ตรงช่วงที่ ping ไม่ตอบ แทนที่จะลากพาดข้าม', () => {
    const wan = snapshot.series.find((item) => item.id === 'wan')!
    const segments = splitSeriesPaths(
      wan.points.map((value, index) => ({ index, value })).filter((point): point is { index: number; value: number } => point.value !== null),
      200,
      (point) => point.index * 600_000,
      (point) => point.value,
      (timestamp) => timestamp / 600_000,
      (value) => value,
      900_000,
    )
    expect(segments.length).toBe(2)
    for (const path of segments.map((points) => svgPathFromPoints(points))) {
      expect(path).not.toContain('NaN')
      expect(path.length).toBeGreaterThan(0)
    }
  })

  test('แท่งกราฟรายชั่วโมงอยู่ในกรอบ plot area', () => {
    const { bars, maxTotal } = svgStackedBars(
      snapshot.hourly.map((item) => [item.wanMs]),
      4,
      12,
      552,
      176,
      0.3,
    )
    expect(bars).toHaveLength(24)
    expect(maxTotal).toBeGreaterThan(0)
    for (const [bar] of bars) {
      expect(bar.y).toBeGreaterThanOrEqual(12)
      expect(bar.y + bar.h).toBeLessThanOrEqual(176.001)
    }
  })
})
