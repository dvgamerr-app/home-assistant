import type { APIRoute } from 'astro'
import { get5Min } from '@/lib/db'
import { num } from '@/lib/electricity'

function computeScale(active: { pv: number; load: number; batt: number; grid: number }[]) {
  if (active.length === 0) return { scaleMin: 0, scaleMax: 1, hasNeg: false, tickNorms: [1, 0.5, 0], yLabels: ['1', '0.5', '0'], gridPct: [8.18, 51.36, 94.55] }
  const battVals = active.map((h) => h.batt)
  const gridVals = active.map((h) => h.grid)
  const dataMax = Math.max(...active.map((h) => Math.max(h.pv, h.load)), 1)
  const dataMin = Math.min(0, ...battVals, ...gridVals)
  const rawStep = dataMax / 4
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)))
  const step = Math.ceil(rawStep / mag) * mag
  const numPos = Math.ceil(dataMax / step)
  const hasNeg = dataMin < -0.05
  const numNeg = hasNeg ? Math.ceil(Math.abs(dataMin) / step) : 0
  const scaleMax = numPos * step
  const scaleMin = -numNeg * step
  const range = scaleMax - scaleMin
  const norm = (v: number) => (v - scaleMin) / range
  const [VH, MT, MB] = [220, 18, 28]
  const ph = VH - MT - MB
  const yTicks = [...Array.from({ length: numPos }, (_, i) => (numPos - i) * step), 0, ...(hasNeg ? Array.from({ length: numNeg }, (_, i) => -(i + 1) * step) : [])]
  const tickNorms = yTicks.map((v) => norm(v))
  const gridPct = yTicks.map((v) => +(((MT + (1 - norm(v)) * ph) / VH) * 100).toFixed(2))
  const yLabels = yTicks.map((v) => (v < 0 ? '−' : '') + num(Math.abs(v), 1))
  return { scaleMin, scaleMax, hasNeg, tickNorms, gridPct, yLabels }
}

export const GET: APIRoute = async () => {
  const now = new Date()
  const currentMinute = now.getHours() * 60 + now.getMinutes()
  const raw = await get5Min()
  const active = raw.filter((s) => s.minuteOfDay <= currentMinute)
  const points = active.map((s) => ({ minuteOfDay: s.minuteOfDay, pv: s.pv, load: s.load, batt: s.batteryPower, grid: s.gridPower }))
  const scale = computeScale(points)
  return Response.json({
    pv: points.map((p) => p.pv),
    load: points.map((p) => p.load),
    batt: points.map((p) => p.batt),
    grid: points.map((p) => p.grid),
    times: points.map((p) => p.minuteOfDay),
    peakPv: Math.max(...points.map((p) => p.pv), 0),
    peakLoad: Math.max(...points.map((p) => p.load), 0),
    peakBattDis: Math.max(...points.map((p) => p.batt), 0),
    ...scale,
  })
}
