import { num } from './electricity'
import { get5Min } from './db'

export type FiveMinChartPoint = {
  minuteOfDay: number
  pv: number
  pv1: number
  pv2: number
  load: number
  batt: number
  grid: number
}

export type FiveMinChartPayload = {
  pv: number[]
  pv1: number[]
  pv2: number[]
  load: number[]
  batt: number[]
  grid: number[]
  times: number[]
  peakPv: number
  peakLoad: number
  peakBattDis: number
  scaleMin: number
  scaleMax: number
  hasNeg: boolean
  tickNorms: number[]
  gridPct: number[]
  yLabels: string[]
}

function computeScale(active: FiveMinChartPoint[]) {
  if (active.length === 0) {
    return {
      scaleMin: 0,
      scaleMax: 1,
      hasNeg: false,
      tickNorms: [1, 0.5, 0],
      yLabels: ['1', '0.5', '0'],
      gridPct: [8.18, 51.36, 94.55],
    }
  }

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

export function buildFiveMinChartPayload(points: FiveMinChartPoint[], currentMinute = 1439): FiveMinChartPayload {
  const active = points.filter((point) => point.minuteOfDay <= currentMinute)
  const scale = computeScale(active)

  return {
    pv: active.map((point) => point.pv),
    pv1: active.map((point) => point.pv1),
    pv2: active.map((point) => point.pv2),
    load: active.map((point) => point.load),
    batt: active.map((point) => point.batt),
    grid: active.map((point) => point.grid),
    times: active.map((point) => point.minuteOfDay),
    peakPv: Math.max(...active.map((point) => point.pv), 0),
    peakLoad: Math.max(...active.map((point) => point.load), 0),
    peakBattDis: Math.max(...active.map((point) => point.batt), 0),
    ...scale,
  }
}

export async function getTodayFiveMinChartPayload(now = new Date()) {
  const points = (await get5Min(now)).map((sample) => ({
    minuteOfDay: sample.minuteOfDay,
    pv: sample.pv,
    pv1: sample.pv1,
    pv2: sample.pv2,
    load: sample.load,
    batt: sample.batteryPower,
    grid: sample.gridPower,
  }))

  return buildFiveMinChartPayload(points, now.getHours() * 60 + now.getMinutes())
}
