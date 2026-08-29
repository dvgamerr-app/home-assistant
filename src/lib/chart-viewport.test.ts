/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'
import { DAY_MS, HOUR_MS, MINUTE_MS, bangkokDayStart, bangkokISODateAt, datesInRange, panTimeRange, zoomTimeRange } from './chart-viewport'

describe('chart time viewport', () => {
  const min = bangkokDayStart('2026-05-11')
  const max = bangkokDayStart('2026-08-20')
  const bounds = { min, max }

  test('converts Bangkok dates without depending on the machine timezone', () => {
    const start = bangkokDayStart('2026-08-19')
    expect(new Date(start).toISOString()).toBe('2026-08-18T17:00:00.000Z')
    expect(bangkokISODateAt(start + 23 * HOUR_MS)).toBe('2026-08-19')
  })

  test('dragging right pans toward older data', () => {
    const start = bangkokDayStart('2026-08-19')
    const range = panTimeRange({ start, end: start + DAY_MS }, 250, 1000, bounds)
    expect(range.start).toBe(start - 6 * HOUR_MS)
    expect(range.end).toBe(start + 18 * HOUR_MS)
  })

  test('wheel zoom keeps the time under the pointer anchored', () => {
    const start = bangkokDayStart('2026-08-19')
    const range = zoomTimeRange({ start, end: start + DAY_MS }, 0.5, 0.25, bounds, 5 * MINUTE_MS, DAY_MS)
    expect(range.end - range.start).toBe(12 * HOUR_MS)
    expect(range.start).toBe(start + 3 * HOUR_MS)
  })

  test('does not zoom farther out than the refreshed one-day view', () => {
    const start = bangkokDayStart('2026-08-19')
    const range = zoomTimeRange({ start, end: start + DAY_MS }, 2, 0.5, bounds, 5 * MINUTE_MS, DAY_MS)
    expect(range).toEqual({ start, end: start + DAY_MS })
  })

  test('zooms in to one five-minute solar interval', () => {
    const start = bangkokDayStart('2026-08-18')
    const range = zoomTimeRange({ start, end: start + DAY_MS }, 0.001, 0, bounds, 5 * MINUTE_MS, DAY_MS)
    expect(range).toEqual({ start, end: start + 5 * MINUTE_MS })
  })

  test('zoom and pan stay inside the available history', () => {
    const range = zoomTimeRange({ start: min, end: min + DAY_MS }, 0.25, 0, bounds, HOUR_MS, 7 * DAY_MS)
    expect(range.start).toBe(min)

    const panned = panTimeRange(range, 1000, 1000, bounds)
    expect(panned).toEqual(range)
  })

  test('enumerates every Bangkok day touched by a continuous range', () => {
    const start = bangkokDayStart('2026-08-18') + 22 * HOUR_MS
    expect(datesInRange({ start, end: start + 5 * HOUR_MS })).toEqual(['2026-08-18', '2026-08-19'])
  })
})
