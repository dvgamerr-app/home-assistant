// กราฟ "กำลังผลิตเทียบค่าสูงสุด" — ซูม/เลื่อน/โหลดย้อนหลังด้วยกลไกเดียวกับ production-chart-client
// ต่างกันที่แกน Y เป็นเปอร์เซ็นต์ของค่าสูงสุดรายชุด ไม่ใช่ kW

import { createLiveSocket, type LiveSocket } from './live-socket'
import { getConnectivity } from './connectivity'
import { splitSeriesPaths, svgPathFromPoints } from './chart'
import { formatPointTime, formatVisibleRange, timeAxisTicks } from './chart-time-axis'
import { DAY_MS, MINUTE_MS, bangkokDayStart, clampTimeRange, datesInRange, panTimeRange, zoomTimeRange, type TimeRange } from './chart-viewport'
import type { FiveMinChartPayload } from './solar-fivemin'
import type { SolarRateChartConfig } from './solar-rate-chart'
import { SOCKET_CHANNELS } from './socket'

type RatePoint = {
  timestamp: number
  pv1: number
  pv2: number
}

const MIN_VIEW_MS = 5 * MINUTE_MS
const MAX_VIEW_MS = DAY_MS
const PATH_MARGIN_MS = 15 * MINUTE_MS
const GAP_MS = 20 * MINUTE_MS
const INSET = { left: 4, top: 18, right: 8, bottom: 28 } as const

function pointsFromPayload(date: string, payload: Pick<FiveMinChartPayload, 'times' | 'pv1' | 'pv2'>): RatePoint[] {
  const dayStart = bangkokDayStart(date)
  return payload.times.map((minuteOfDay, index) => ({
    timestamp: dayStart + minuteOfDay * MINUTE_MS,
    pv1: payload.pv1[index] ?? 0,
    pv2: payload.pv2[index] ?? 0,
  }))
}

/** เพดานแกน Y ปัดขึ้นทีละ 25% และไม่ต่ำกว่า 100% เพื่อให้เส้น 100% เป็นหลักอ้างอิงเสมอ */
function scaleTopForPeak(peakPercent: number) {
  return Math.max(100, Math.ceil(Math.max(peakPercent, 1) / 25) * 25)
}

export function initSolarRateChart(root: HTMLElement) {
  const wrapNullable = root.querySelector<HTMLElement>('.solar-rate-chart-wrapper')
  const svgNullable = wrapNullable?.querySelector<SVGSVGElement>('svg')
  const tipNullable = root.querySelector<HTMLElement>('.solar-rate-tip')
  const xAxisNullable = root.querySelector<HTMLElement>('.solar-rate-x-axis')
  const yAxisNullable = root.querySelector<HTMLElement>('.solar-rate-y-axis')
  const visibleRangeNullable = root.querySelector<HTMLElement>('.solar-rate-visible-range')
  const loadStateNullable = root.querySelector<HTMLElement>('.solar-rate-load-state')
  if (!wrapNullable || !svgNullable || !tipNullable || !xAxisNullable || !yAxisNullable || !visibleRangeNullable || !loadStateNullable) return
  const wrap = wrapNullable
  const svg = svgNullable
  const tip = tipNullable
  const xAxis = xAxisNullable
  const yAxis = yAxisNullable
  const visibleRange = visibleRangeNullable
  const loadState = loadStateNullable

  const config = JSON.parse(root.dataset.solarRateChart ?? '{}') as SolarRateChartConfig
  const { pv1MaxKw, pv2MaxKw } = config
  const bounds = { min: bangkokDayStart(config.historyStart), max: bangkokDayStart(config.today) + DAY_MS }
  const selectedStart = bangkokDayStart(config.selectedDate)
  let viewport = clampTimeRange({ start: selectedStart, end: selectedStart + DAY_MS }, bounds, MIN_VIEW_MS, MAX_VIEW_MS)

  const dayCache = new Map<string, RatePoint[]>()
  const loading = new Map<string, Promise<void>>()
  dayCache.set(config.selectedDate, pointsFromPayload(config.selectedDate, config))

  let plotLeft = 0
  let plotRight = 0
  let svgWidth = 0
  let visiblePoints: RatePoint[] = []
  let crosshair: SVGLineElement | null = null
  let animationFrame = 0
  let live: LiveSocket | null = null
  let disposed = false

  const pointers = new Map<number, { x: number; y: number }>()
  let dragDistance = 0
  let pinchStart: { range: TimeRange; distance: number; anchorTime: number } | null = null

  const toPct = (kw: number, maxKw: number) => (maxKw > 0 ? (kw / maxKw) * 100 : 0)

  const hideTooltip = () => {
    tip.classList.add('hidden')
    crosshair?.setAttribute('visibility', 'hidden')
  }

  const setLoadingState = (message = '') => {
    loadState.textContent = message
    loadState.classList.toggle('hidden', message === '')
  }

  function cachedPoints(range: TimeRange, margin = 0) {
    const wanted = {
      start: Math.max(bounds.min, range.start - margin),
      end: Math.min(bounds.max, range.end + margin),
    }
    return datesInRange(wanted)
      .flatMap((date) => dayCache.get(date) ?? [])
      .filter((point) => point.timestamp >= wanted.start && point.timestamp <= wanted.end)
      .sort((a, b) => a.timestamp - b.timestamp)
  }

  function scheduleDraw() {
    if (animationFrame || disposed) return
    animationFrame = requestAnimationFrame(() => {
      animationFrame = 0
      draw()
    })
  }

  async function loadDate(date: string) {
    if (dayCache.has(date)) return
    const existing = loading.get(date)
    if (existing) return existing

    const request = (async () => {
      const response = await fetch(`/api/solar/five-min?date=${encodeURIComponent(date)}`, { headers: { Accept: 'application/json' } })
      if (!response.ok) throw new Error(`five-minute history request failed: ${response.status}`)
      const payload = (await response.json()) as FiveMinChartPayload
      dayCache.set(date, pointsFromPayload(date, payload))
    })()
      .catch(() => {
        setLoadingState(getConnectivity().online ? 'โหลดข้อมูลย้อนหลังไม่สำเร็จ' : 'ออฟไลน์ — ไม่มีข้อมูลวันนั้นบันทึกไว้ในเครื่อง')
      })
      .finally(() => {
        loading.delete(date)
        if (loading.size === 0 && loadState.textContent !== 'โหลดข้อมูลย้อนหลังไม่สำเร็จ') setLoadingState()
        scheduleDraw()
      })

    loading.set(date, request)
    return request
  }

  function ensureVisibleData() {
    const wanted = {
      start: Math.max(bounds.min, viewport.start - PATH_MARGIN_MS),
      end: Math.min(bounds.max, viewport.end + PATH_MARGIN_MS),
    }
    const missing = datesInRange(wanted).filter((date) => !dayCache.has(date) && !loading.has(date))
    if (missing.length === 0) return
    setLoadingState('กำลังโหลดข้อมูลย้อนหลัง…')
    for (const date of missing) void loadDate(date)
  }

  /** ตัวเลขหัวการ์ดผูกกับช่วงที่มองเห็น ไม่ใช่ทั้งวัน — ซูมแล้วตัวเลขจึงตรงกับเส้นที่เห็น */
  function updateSummary(points: RatePoint[]) {
    const peakPv1Kw = Math.max(...points.map((point) => point.pv1), 0)
    const peakPv2Kw = Math.max(...points.map((point) => point.pv2), 0)
    const set = (selector: string, text: string) => {
      const element = root.querySelector<HTMLElement>(selector)
      if (element) element.textContent = text
    }
    set('.solar-rate-pv1-pct', toPct(peakPv1Kw, pv1MaxKw).toFixed(0))
    set('.solar-rate-pv1-kw', peakPv1Kw.toFixed(2))
    set('.solar-rate-pv2-pct', toPct(peakPv2Kw, pv2MaxKw).toFixed(0))
    set('.solar-rate-pv2-kw', peakPv2Kw.toFixed(2))
  }

  function updateAxes(scaleTop: number, chartHeight: number, top: number, bottom: number) {
    const plotHeight = bottom - top
    yAxis.innerHTML = Array.from({ length: 5 }, (_, index) => scaleTop - (scaleTop / 4) * index)
      .map((value, index) => {
        const y = top + (1 - value / scaleTop) * plotHeight
        const cls = index === 0 ? 'font-medium text-foreground/60' : 'text-muted-foreground'
        return `<span class="absolute right-0 text-right text-[9px] leading-none ${cls}" style="top:${((y / chartHeight) * 100).toFixed(2)}%;transform:translateY(-50%)">${value.toFixed(0)}%</span>`
      })
      .join('')

    xAxis.innerHTML = timeAxisTicks(viewport, plotRight - plotLeft)
      .map(({ ratio, label }) => {
        const translate = ratio < 0.02 ? '' : ratio > 0.98 ? '-translate-x-full' : '-translate-x-1/2'
        return `<span class="absolute ${translate} whitespace-nowrap" style="left:${(ratio * 100).toFixed(2)}%">${label}</span>`
      })
      .join('')
    xAxis.style.marginLeft = `${plotLeft}px`
    xAxis.style.marginRight = `${Math.max(svgWidth - plotRight, 0)}px`
    visibleRange.textContent = formatVisibleRange(viewport)
  }

  function draw() {
    const width = wrap.clientWidth
    const height = wrap.clientHeight
    if (width <= 0 || height <= 0) return

    const left = INSET.left
    const top = INSET.top
    const right = width - INSET.right
    const bottom = height - INSET.bottom
    const plotHeight = bottom - top
    svgWidth = width
    plotLeft = left
    plotRight = right
    visiblePoints = cachedPoints(viewport, PATH_MARGIN_MS)
    const summaryPoints = visiblePoints.filter((point) => point.timestamp >= viewport.start && point.timestamp <= viewport.end)
    const peakPct = Math.max(...summaryPoints.map((point) => Math.max(toPct(point.pv1, pv1MaxKw), toPct(point.pv2, pv2MaxKw))), 0)
    const scaleTop = scaleTopForPeak(peakPct)
    const span = viewport.end - viewport.start
    const x = (timestamp: number) => left + ((timestamp - viewport.start) / span) * (right - left)
    const y = (value: number) => top + (1 - Math.max(0, Math.min(1, value / scaleTop))) * plotHeight
    const maxRenderPoints = Math.max(Math.floor((right - left) * 2), 240)

    const paths = (value: (point: RatePoint) => number) => splitSeriesPaths(visiblePoints, maxRenderPoints, (point) => point.timestamp, value, x, y, GAP_MS)
    const mppt1Paths = paths((point) => toPct(point.pv1, pv1MaxKw))
    const mppt2Paths = paths((point) => toPct(point.pv2, pv2MaxKw))
    const lineMarkup = (groups: { x: number; y: number }[][], attributes: string) => groups.map((group) => `<path d="${svgPathFromPoints(group)}" ${attributes}/>`).join('')
    const areaMarkup = (groups: { x: number; y: number }[][], fill: string) =>
      groups.map((group) => `<path d="${svgPathFromPoints(group)} L ${group.at(-1)!.x.toFixed(1)},${bottom} L ${group[0]!.x.toFixed(1)},${bottom} Z" fill="${fill}"/>`).join('')
    const gridLines = Array.from({ length: 5 }, (_, index) => (top + (plotHeight * index) / 4).toFixed(1))

    svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
    svg.innerHTML = `
      <defs>
        <linearGradient id="solar-rate-mppt1-grad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="var(--chart-4)" stop-opacity="0.28"/><stop offset="100%" stop-color="var(--chart-4)" stop-opacity="0.04"/></linearGradient>
        <linearGradient id="solar-rate-mppt2-grad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="var(--chart-1)" stop-opacity="0.24"/><stop offset="100%" stop-color="var(--chart-1)" stop-opacity="0.04"/></linearGradient>
        <clipPath id="solar-rate-clip"><rect x="${left}" y="${top}" width="${right - left}" height="${plotHeight}"/></clipPath>
      </defs>
      <line x1="${left}" x2="${right}" y1="${bottom}" y2="${bottom}" stroke="var(--border)" stroke-opacity="0.8" stroke-width="0.5"/>
      ${gridLines.map((gridY) => `<line x1="${left}" x2="${right}" y1="${gridY}" y2="${gridY}" stroke="var(--border)" stroke-opacity="0.8" stroke-width="0.5" stroke-dasharray="2 4"/>`).join('')}
      <g clip-path="url(#solar-rate-clip)">
        ${areaMarkup(mppt1Paths, 'url(#solar-rate-mppt1-grad)')}
        ${areaMarkup(mppt2Paths, 'url(#solar-rate-mppt2-grad)')}
        ${lineMarkup(mppt1Paths, 'fill="none" stroke="var(--chart-4)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"')}
        ${lineMarkup(mppt2Paths, 'fill="none" stroke="var(--chart-1)" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="4 3"')}
      </g>
      <line class="solar-rate-crosshair" x1="0" x2="0" y1="${top}" y2="${bottom}" stroke="var(--foreground)" stroke-opacity="0.2" stroke-width="0.5" visibility="hidden"/>
      <rect x="${left}" y="${top}" width="${right - left}" height="${plotHeight}" fill="transparent"/>`

    crosshair = svg.querySelector('.solar-rate-crosshair')
    updateAxes(scaleTop, height, top, bottom)
    updateSummary(summaryPoints)
  }

  function setViewport(next: TimeRange) {
    viewport = clampTimeRange(next, bounds, MIN_VIEW_MS, MAX_VIEW_MS)
    hideTooltip()
    scheduleDraw()
    ensureVisibleData()
  }

  function showTooltip(clientX: number, clientY: number) {
    if (!crosshair || visiblePoints.length === 0 || pointers.size > 0) return
    const rect = svg.getBoundingClientRect()
    const sx = ((clientX - rect.left) / rect.width) * svgWidth
    if (sx < plotLeft || sx > plotRight) return hideTooltip()
    const target = viewport.start + ((sx - plotLeft) / (plotRight - plotLeft)) * (viewport.end - viewport.start)
    const point = visiblePoints.reduce((closest, candidate) => (Math.abs(candidate.timestamp - target) < Math.abs(closest.timestamp - target) ? candidate : closest))
    if (point.timestamp < viewport.start || point.timestamp > viewport.end) return hideTooltip()

    const crosshairX = plotLeft + ((point.timestamp - viewport.start) / (viewport.end - viewport.start)) * (plotRight - plotLeft)
    crosshair.setAttribute('x1', crosshairX.toFixed(1))
    crosshair.setAttribute('x2', crosshairX.toFixed(1))
    crosshair.setAttribute('visibility', 'visible')
    tip.querySelector<HTMLElement>('.solar-rate-tip-hour')!.textContent = formatPointTime(point.timestamp)
    tip.querySelector<HTMLElement>('.solar-rate-tip-pv1')!.textContent = `${toPct(point.pv1, pv1MaxKw).toFixed(0)}% • ${point.pv1.toFixed(2)} kW`
    tip.querySelector<HTMLElement>('.solar-rate-tip-pv2')!.textContent = `${toPct(point.pv2, pv2MaxKw).toFixed(0)}% • ${point.pv2.toFixed(2)} kW`
    tip.classList.remove('hidden')
    tip.style.left = `${Math.min(clientX + 14, window.innerWidth - 204)}px`
    tip.style.top = `${Math.max(clientY - 90, 8)}px`
  }

  function beginPinch() {
    const [first, second] = [...pointers.values()]
    if (!first || !second) return
    const rect = svg.getBoundingClientRect()
    const center = (first.x + second.x) / 2
    const ratio = Math.max(0, Math.min(1, (center - rect.left) / rect.width))
    pinchStart = {
      range: { ...viewport },
      distance: Math.max(Math.hypot(second.x - first.x, second.y - first.y), 1),
      anchorTime: viewport.start + (viewport.end - viewport.start) * ratio,
    }
    hideTooltip()
  }

  svg.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault()
      const rect = svg.getBoundingClientRect()
      const ratio = (event.clientX - rect.left) / rect.width
      setViewport(zoomTimeRange(viewport, Math.exp(event.deltaY * 0.0015), ratio, bounds, MIN_VIEW_MS, MAX_VIEW_MS))
    },
    { passive: false },
  )

  svg.addEventListener('pointerdown', (event) => {
    event.preventDefault()
    svg.setPointerCapture(event.pointerId)
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    dragDistance = 0
    svg.style.cursor = 'grabbing'
    if (pointers.size === 2) beginPinch()
  })

  svg.addEventListener('pointermove', (event) => {
    if (!pointers.has(event.pointerId)) {
      if (event.pointerType === 'mouse') showTooltip(event.clientX, event.clientY)
      return
    }

    event.preventDefault()
    const previousX = pointers.get(event.pointerId)!.x
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })

    if (pointers.size >= 2) {
      if (!pinchStart) beginPinch()
      const [first, second] = [...pointers.values()]
      if (!pinchStart || !first || !second) return
      const rect = svg.getBoundingClientRect()
      const distance = Math.max(Math.hypot(second.x - first.x, second.y - first.y), 1)
      const center = (first.x + second.x) / 2
      const ratio = Math.max(0, Math.min(1, (center - rect.left) / rect.width))
      const initialSpan = pinchStart.range.end - pinchStart.range.start
      const nextSpan = Math.min(Math.max(initialSpan * (pinchStart.distance / distance), MIN_VIEW_MS), MAX_VIEW_MS)
      setViewport({ start: pinchStart.anchorTime - ratio * nextSpan, end: pinchStart.anchorTime + (1 - ratio) * nextSpan })
      return
    }

    const deltaX = event.clientX - previousX
    dragDistance += Math.abs(deltaX)
    setViewport(panTimeRange(viewport, deltaX, Math.max(plotRight - plotLeft, 1), bounds))
  })

  const endPointer = (event: PointerEvent) => {
    if (!pointers.has(event.pointerId)) return
    pointers.delete(event.pointerId)
    if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId)
    pinchStart = null
    if (pointers.size === 0) {
      svg.style.cursor = 'grab'
      if (dragDistance < 3 && event.pointerType === 'mouse') showTooltip(event.clientX, event.clientY)
    }
  }
  svg.addEventListener('pointerup', endPointer)
  svg.addEventListener('pointercancel', endPointer)
  svg.addEventListener('mouseleave', () => {
    if (pointers.size === 0) hideTooltip()
  })

  const resizeObserver = new ResizeObserver(scheduleDraw)
  resizeObserver.observe(wrap)
  draw()
  ensureVisibleData()

  if (config.isToday) {
    live = createLiveSocket(config.socketUrl, [SOCKET_CHANNELS.solarFiveMin], (socket) => {
      socket.on(SOCKET_CHANNELS.solarFiveMin, (payload: FiveMinChartPayload) => {
        dayCache.set(config.today, pointsFromPayload(config.today, payload))
        scheduleDraw()
      })
    })
  }

  window.addEventListener(
    'pagehide',
    () => {
      disposed = true
      resizeObserver.disconnect()
      live?.dispose()
      if (animationFrame) cancelAnimationFrame(animationFrame)
    },
    { once: true },
  )
}
