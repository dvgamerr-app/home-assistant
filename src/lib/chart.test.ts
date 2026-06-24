import { test, expect } from 'bun:test'
import { svgLine, svgArea, svgStackedBars } from './chart'

test('svgLine: < 2 values returns empty string', () => {
  expect(svgLine([], 0, 0, 100, 100)).toBe('')
  expect(svgLine([0.5], 0, 0, 100, 100)).toBe('')
})

test('svgLine: value=1 maps to yMin (top), value=0 maps to yMax (bottom)', () => {
  const path = svgLine([1, 0], 0, 0, 100, 100)
  expect(path.startsWith('M 0.0,0.0')).toBe(true) // i=0, v=1 → y=0+0*100=0
  expect(path).toContain('100.0,100.0') // i=1, v=0 → y=100
})

test('svgLine: smooth curve control points stay inside the plot area', () => {
  const path = svgLine([0, 1, 0], 0, 0, 100, 100)
  const yValues = [...path.matchAll(/(?:^|[ ,])[-\d.]+,([-\d.]+)/g)].map((m) => Number(m[1]))
  expect(Math.min(...yValues)).toBeGreaterThanOrEqual(0)
  expect(Math.max(...yValues)).toBeLessThanOrEqual(100)
})

test('svgArea: closes path to bottom corners', () => {
  const path = svgArea([0.5, 0.5], 0, 0, 100, 100)
  expect(path.endsWith('L 100,100 L 0,100 Z')).toBe(true)
})

test('svgStackedBars: heights sum correctly, max=total', () => {
  const bars = svgStackedBars(
    [
      [8, 2],
      [6, 4],
    ],
    0,
    0,
    100,
    100,
    0,
  )
  // maxTotal = 10, plotH = 100
  expect(bars[0][0].h).toBeCloseTo(80) // selfUse=8 → 80%
  expect(bars[0][1].h).toBeCloseTo(20) // gridImport=2 → 20%
  expect(bars[1][0].h).toBeCloseTo(60)
  expect(bars[1][1].h).toBeCloseTo(40)
})

test('svgStackedBars: topmost visible segment gets rx=1.5', () => {
  const bars = svgStackedBars([[8, 2]], 0, 0, 100, 100)
  expect(bars[0][0].rx).toBe(0) // bottom segment: square
  expect(bars[0][1].rx).toBe(1.5) // top segment: rounded
})

test('svgStackedBars: zero-only top segment → bottom segment gets rx', () => {
  const bars = svgStackedBars([[5, 0]], 0, 0, 100, 100)
  expect(bars[0][0].rx).toBe(1.5) // only visible segment gets rx
  expect(bars[0][1].h).toBe(0)
})
