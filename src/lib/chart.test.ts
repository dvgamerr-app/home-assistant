// Runnable check: `bun test`
import { test, expect } from 'bun:test'
import { colScale, lineScale, pieScale } from './chart'

test('colScale normalizes against max and clamps to 1', () => {
  expect(colScale([5, 10], 10)).toEqual([
    { value: 5, size: 0.5 },
    { value: 10, size: 1 },
  ])
  expect(colScale([20], 10)[0].size).toBe(1) // clamped
})

test('lineScale uses previous point as start (first point starts at itself)', () => {
  const pts = lineScale([2, 6], 10)
  expect(pts[0]).toEqual({ value: 2, start: 0.2, end: 0.2 })
  expect(pts[1]).toEqual({ value: 6, start: 0.2, end: 0.6 })
})

test('pieScale accumulates start and sizes sum to 1', () => {
  const slices = pieScale([1, 1, 2])
  expect(slices.map((s) => s.start)).toEqual([0, 0.25, 0.5])
  expect(slices.reduce((s, x) => s + x.size, 0)).toBeCloseTo(1)
})
