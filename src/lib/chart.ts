// Helpers to map data to the unitless 0..1 fractions Charts.css expects.
// bar/column read `--size`; line/area read `--start` (previous point) and `--end` (current point).
// ponytail: tiny pure-math layer — charts are static HTML tables, no charting lib needed.

const clamp01 = (n: number) => Math.max(0, Math.min(1, n))

export type ColPoint = { value: number; size: number }
export type LinePoint = { value: number; start: number; end: number }
export type PieSlice = { value: number; start: number; size: number }

/** Column/bar: each value as a fraction of `max`. */
export function colScale(values: number[], max = Math.max(...values, 1)): ColPoint[] {
  return values.map((v) => ({ value: v, size: clamp01(v / max) }))
}

/** Line/area: --start = previous point, --end = current point (both fractions of `max`). */
export function lineScale(values: number[], max = Math.max(...values, 1)): LinePoint[] {
  return values.map((v, i) => ({
    value: v,
    start: clamp01((values[i - 1] ?? v) / max),
    end: clamp01(v / max),
  }))
}

/** Pie: cumulative `--start` plus slice `--size`, as fractions of the total. */
export function pieScale(values: number[]): PieSlice[] {
  const total = values.reduce((s, v) => s + v, 0) || 1
  let acc = 0
  return values.map((v) => {
    const start = acc / total
    acc += v
    return { value: v, start, size: v / total }
  })
}
