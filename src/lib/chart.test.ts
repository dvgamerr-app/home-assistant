/// <reference types="bun" />
import { test, expect } from 'bun:test'
import { svgLine, svgArea, svgAreaFromPoints, svgStackedBars } from './chart'

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
  const { bars } = svgStackedBars(
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
  const { bars } = svgStackedBars([[8, 2]], 0, 0, 100, 100)
  expect(bars[0][0].rx).toBe(0) // bottom segment: square
  expect(bars[0][1].rx).toBe(1.5) // top segment: rounded
})

test('svgStackedBars: zero-only top segment → bottom segment gets rx', () => {
  const { bars } = svgStackedBars([[5, 0]], 0, 0, 100, 100)
  expect(bars[0][0].rx).toBe(1.5) // only visible segment gets rx
  expect(bars[0][1].h).toBe(0)
})

test('svgStackedBars: returns the maxTotal used to scale the bars', () => {
  const { maxTotal } = svgStackedBars(
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
  expect(maxTotal).toBe(10)
})

test('svgStackedBars: maxTotal floors at 1 so all-zero data still scales', () => {
  expect(svgStackedBars([[0, 0]], 0, 0, 100, 100).maxTotal).toBe(1)
})

test('svgAreaFromPoints: closes the curve down to the baseline', () => {
  const path = svgAreaFromPoints(
    [
      { x: 0, y: 10 },
      { x: 100, y: 20 },
    ],
    50,
  )
  expect(path.startsWith('M 0.0,10.0')).toBe(true)
  expect(path.endsWith('L 100.0,50 L 0.0,50 Z')).toBe(true)
})

test('svgAreaFromPoints: < 2 points returns empty string instead of an "undefined" path', () => {
  expect(svgAreaFromPoints([], 50)).toBe('')
  expect(svgAreaFromPoints([{ x: 0, y: 0 }], 50)).toBe('')
})
