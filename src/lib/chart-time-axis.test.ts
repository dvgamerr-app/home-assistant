import { describe, expect, test } from 'bun:test'
import { formatVisibleRange, tickInterval, timeAxisTicks } from './chart-time-axis'
import { DAY_MS, HOUR_MS, MINUTE_MS, bangkokDayStart } from './chart-viewport'

const day = bangkokDayStart('2026-09-17')

describe('chart time axis', () => {
  test('picks a coarser tick interval as the visible span grows', () => {
    expect(tickInterval(2 * HOUR_MS, 600)).toBe(30 * MINUTE_MS)
    expect(tickInterval(DAY_MS, 600)).toBe(6 * HOUR_MS)
    expect(tickInterval(7 * DAY_MS, 600)).toBe(DAY_MS)
  })

  test('places ticks on round Bangkok times inside the visible range', () => {
    const ticks = timeAxisTicks({ start: day, end: day + DAY_MS }, 600)

    expect(ticks[0]).toEqual({ ratio: 0, label: '00:00' })
    expect(ticks.at(-1)?.label).toBe('18:00')
    expect(ticks.every((tick) => tick.ratio >= 0 && tick.ratio < 1)).toBe(true)
  })

  test('adds the day to labels once the range crosses midnight', () => {
    const ticks = timeAxisTicks({ start: day + 20 * HOUR_MS, end: day + 30 * HOUR_MS }, 600)

    expect(ticks.every((tick) => tick.label.includes(' · '))).toBe(true)
  })

  test('summarises the visible range as one day or a span of days', () => {
    expect(formatVisibleRange({ start: day, end: day + DAY_MS })).toContain('00:00–23:59')
    expect(formatVisibleRange({ start: day, end: day + 2 * DAY_MS })).toContain('–')
  })
})
