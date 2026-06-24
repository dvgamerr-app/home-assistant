// Pure-math helpers for server-rendered SVG charts (Astro frontmatter, no JS at runtime).

const clamp01 = (n: number) => Math.max(0, Math.min(1, n))

/** Smooth cubic-bezier SVG line path.
 *  values: normalized 0..1 (0 = bottom, 1 = top).
 *  Plot area: (xMin,yMin) → (xMax,yMax) in SVG coordinate space.
 */
export function svgLine(values: number[], xMin: number, yMin: number, xMax: number, yMax: number, tension = 0.9): string {
  if (values.length < 2) return ''
  const pts = values.map((v, i) => ({
    x: xMin + (i / (values.length - 1)) * (xMax - xMin),
    y: yMin + (1 - clamp01(v)) * (yMax - yMin),
  }))

  const curve = clamp01(tension)
  const slopes = pts.slice(0, -1).map((p, i) => (pts[i + 1].y - p.y) / (pts[i + 1].x - p.x))
  const tangents = pts.map((_, i) => {
    if (i === 0) return slopes[0]
    if (i === pts.length - 1) return slopes[slopes.length - 1]

    const prev = slopes[i - 1]
    const next = slopes[i]
    if (prev === 0 || next === 0 || Math.sign(prev) !== Math.sign(next)) return 0
    return (2 * prev * next) / (prev + next)
  })

  slopes.forEach((slope, i) => {
    if (slope === 0) {
      tangents[i] = 0
      tangents[i + 1] = 0
      return
    }

    const a = tangents[i] / slope
    const b = tangents[i + 1] / slope
    const h = Math.hypot(a, b)
    if (h > 3) {
      const scale = 3 / h
      tangents[i] = scale * a * slope
      tangents[i + 1] = scale * b * slope
    }
  })

  let d = `M ${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`
  for (let i = 1; i < pts.length; i++) {
    const p1 = pts[i - 1]
    const p2 = pts[i]
    const dx = (p2.x - p1.x) / 3
    const cp1x = p1.x + dx * curve
    const cp1y = p1.y + tangents[i - 1] * dx * curve
    const cp2x = p2.x - dx * curve
    const cp2y = p2.y - tangents[i] * dx * curve
    d += ` C ${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`
  }
  return d
}

/** svgLine closed to the bottom — for area gradient fills. */
export function svgArea(values: number[], xMin: number, yMin: number, xMax: number, yMax: number, tension = 0.9): string {
  return `${svgLine(values, xMin, yMin, xMax, yMax, tension)} L ${xMax},${yMax} L ${xMin},${yMax} Z`
}

export type BarSegment = { x: number; y: number; w: number; h: number; value: number; rx: number }

/**
 * Stacked bar rects.
 * data[barIndex] = [bottomValue, ...topValues] stacked upward.
 * Returns rects[barIndex][stackIndex].
 * The topmost visible segment gets rx=1.5 for rounded top corners.
 */
export function svgStackedBars(data: number[][], xMin: number, yMin: number, xMax: number, yMax: number, gapFrac = 0.2): BarSegment[][] {
  const n = data.length
  const maxTotal = Math.max(...data.map((d) => d.reduce((s, v) => s + v, 0)), 1)
  const groupW = (xMax - xMin) / n
  const barW = groupW * (1 - gapFrac)
  const plotH = yMax - yMin

  return data.map((stacks, i) => {
    const x = xMin + i * groupW + (groupW - barW) / 2
    let bottom = yMax
    const topIdx = stacks.reduceRight((found, v, idx) => (found === -1 && v > 0 ? idx : found), -1)
    return stacks.map((v, j) => {
      const h = Math.max((v / maxTotal) * plotH, 0)
      const y = bottom - h
      bottom = y
      return { x, y, w: barW, h, value: v, rx: j === topIdx ? 1.5 : 0 }
    })
  })
}
