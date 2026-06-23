// Pure-math helpers for server-rendered SVG charts (Astro frontmatter, no JS at runtime).

const clamp01 = (n: number) => Math.max(0, Math.min(1, n))

/** Smooth cubic-bezier SVG line path.
 *  values: normalized 0..1 (0 = bottom, 1 = top).
 *  Plot area: (xMin,yMin) → (xMax,yMax) in SVG coordinate space.
 */
export function svgLine(values: number[], xMin: number, yMin: number, xMax: number, yMax: number, tension = 0.4): string {
  if (values.length < 2) return ''
  const pts = values.map((v, i) => ({
    x: xMin + (i / (values.length - 1)) * (xMax - xMin),
    y: yMin + (1 - clamp01(v)) * (yMax - yMin),
  }))
  let d = `M ${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`
  for (let i = 1; i < pts.length; i++) {
    const p0 = pts[Math.max(i - 2, 0)]
    const p1 = pts[i - 1]
    const p2 = pts[i]
    const p3 = pts[Math.min(i + 1, pts.length - 1)]
    const cp1x = p1.x + (p2.x - p0.x) * tension
    const cp1y = p1.y + (p2.y - p0.y) * tension
    const cp2x = p2.x - (p3.x - p1.x) * tension
    const cp2y = p2.y - (p3.y - p1.y) * tension
    d += ` C ${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`
  }
  return d
}

/** svgLine closed to the bottom — for area gradient fills. */
export function svgArea(values: number[], xMin: number, yMin: number, xMax: number, yMax: number, tension = 0.4): string {
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
