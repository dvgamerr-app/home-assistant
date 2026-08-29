import { io, type Socket } from 'socket.io-client'
import { svgPathFromPoints } from './chart'
import { BANGKOK_OFFSET_MS, DAY_MS, HOUR_MS, MINUTE_MS, bangkokDayStart, bangkokISODateAt, clampTimeRange, datesInRange, panTimeRange, zoomTimeRange, type TimeRange } from './chart-viewport'
import type { FiveMinChartPayload } from './solar-fivemin'
import { SOCKET_CHANNELS } from './socket'

type ChartConfig = FiveMinChartPayload & {
  selectedDate: string
  today: string
  historyStart: string
  isToday: boolean
  socketUrl: string
}

type PowerPoint = {
  timestamp: number
  pv: number
  load: number
  batt: number
  grid: number
}

type Scale = {
  min: number
  max: number
  ticks: number[]
}

const MIN_VIEW_MS = 5 * MINUTE_MS
const MAX_VIEW_MS = DAY_MS
const PATH_MARGIN_MS = 15 * MINUTE_MS
const numberFormat = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const dayFormat = new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: '2-digit' })
const shortDayFormat = new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short' })
const timeFormat = new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

function pointsFromPayload(date: string, payload: FiveMinChartPayload): PowerPoint[] {
  const dayStart = bangkokDayStart(date)
  return payload.times.map((minuteOfDay, index) => ({
    timestamp: dayStart + minuteOfDay * MINUTE_MS,
    pv: payload.pv[index] ?? 0,
    load: payload.load[index] ?? 0,
    batt: payload.batt[index] ?? 0,
    grid: payload.grid[index] ?? 0,
  }))
}

function computeScale(points: PowerPoint[]): Scale {
  const dataMax = Math.max(...points.map((point) => Math.max(point.pv, point.load)), 1)
  const dataMin = Math.min(0, ...points.map((point) => Math.min(point.batt, point.grid)))
  const rawStep = dataMax / 4
  const magnitude = 10 ** Math.floor(Math.log10(rawStep))
  const step = Math.ceil(rawStep / magnitude) * magnitude
  const positiveTicks = Math.ceil(dataMax / step)
  const negativeTicks = dataMin < -0.05 ? Math.ceil(Math.abs(dataMin) / step) : 0
  const max = positiveTicks * step
  const min = -negativeTicks * step

  return {
    min,
    max,
    ticks: [...Array.from({ length: positiveTicks }, (_, index) => (positiveTicks - index) * step), 0, ...Array.from({ length: negativeTicks }, (_, index) => -(index + 1) * step)],
  }
}

function splitPaths(points: PowerPoint[], maxPoints: number, value: (point: PowerPoint) => number, x: (timestamp: number) => number, y: (value: number) => number) {
  const groups: PowerPoint[][] = []
  for (const point of points) {
    const previous = groups.at(-1)?.at(-1)
    if (!previous || point.timestamp - previous.timestamp > 20 * MINUTE_MS) groups.push([])
    groups.at(-1)!.push(point)
  }
  const step = Math.ceil(points.length / maxPoints)
  return groups
    .map((group) => group.filter((_, index) => index % step === 0 || index === group.length - 1).map((point) => ({ x: x(point.timestamp), y: y(value(point)) })))
    .filter((group) => group.length >= 2)
}

function formatVisibleRange(range: TimeRange) {
  const firstDate = bangkokISODateAt(range.start)
  const lastDate = bangkokISODateAt(range.end - 1)
  if (firstDate === lastDate) return `${dayFormat.format(range.start)} · ${timeFormat.format(range.start)}–${timeFormat.format(range.end - 1)} น.`
  return `${shortDayFormat.format(range.start)} ${timeFormat.format(range.start)} – ${shortDayFormat.format(range.end - 1)} ${timeFormat.format(range.end - 1)} น.`
}

function tickInterval(span: number, width: number) {
  const targetCount = Math.max(3, Math.min(8, Math.floor(width / 76)))
  const target = span / targetCount
  return [15 * MINUTE_MS, 30 * MINUTE_MS, HOUR_MS, 2 * HOUR_MS, 3 * HOUR_MS, 6 * HOUR_MS, 12 * HOUR_MS, DAY_MS].find((interval) => interval >= target) ?? DAY_MS
}

export function initProductionChart(root: HTMLElement) {
  const wrapNullable = root.querySelector<HTMLElement>('.pv-chart-wrapper')
  const svgNullable = wrapNullable?.querySelector<SVGSVGElement>('svg')
  const tipNullable = root.querySelector<HTMLElement>('.pv-chart-tip')
  const xAxisNullable = root.querySelector<HTMLElement>('.pv-x-axis')
  const yAxisNullable = root.querySelector<HTMLElement>('.pv-y-axis')
  const visibleRangeNullable = root.querySelector<HTMLElement>('.pv-visible-range')
  const loadStateNullable = root.querySelector<HTMLElement>('.pv-load-state')
  if (!wrapNullable || !svgNullable || !tipNullable || !xAxisNullable || !yAxisNullable || !visibleRangeNullable || !loadStateNullable) return
  const wrap = wrapNullable
  const svg = svgNullable
  const tip = tipNullable
  const xAxis = xAxisNullable
  const yAxis = yAxisNullable
  const visibleRange = visibleRangeNullable
  const loadState = loadStateNullable

  const config = JSON.parse(root.dataset.productionChart ?? '{}') as ChartConfig
  const historyStart = bangkokDayStart(config.historyStart)
  const historyEnd = bangkokDayStart(config.today) + DAY_MS
  const bounds = { min: historyStart, max: historyEnd }
  const selectedStart = bangkokDayStart(config.selectedDate)
  let viewport = clampTimeRange({ start: selectedStart, end: selectedStart + DAY_MS }, bounds, MIN_VIEW_MS, MAX_VIEW_MS)

  const dayCache = new Map<string, PowerPoint[]>()
  const loading = new Map<string, Promise<void>>()
  dayCache.set(config.selectedDate, pointsFromPayload(config.selectedDate, config))

  let plotLeft = 0
  let plotRight = 0
  let svgWidth = 0
  let visiblePoints: PowerPoint[] = []
  let crosshair: SVGLineElement | null = null
  let animationFrame = 0
  let socket: Socket | null = null
  let disposed = false

  const pointers = new Map<number, { x: number; y: number }>()
  let dragDistance = 0
  let pinchStart: { range: TimeRange; distance: number; anchorTime: number } | null = null

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
        setLoadingState('โหลดข้อมูลย้อนหลังไม่สำเร็จ')
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

  function updateSummary(points: PowerPoint[]) {
    const peakPv = Math.max(...points.map((point) => point.pv), 0)
    const peakLoad = Math.max(...points.map((point) => point.load), 0)
    const peakBatt = Math.max(...points.map((point) => point.batt), 0)
    const pvEl = root.querySelector<HTMLElement>('.pv-peak-pv')
    const loadEl = root.querySelector<HTMLElement>('.pv-peak-load')
    const battEl = root.querySelector<HTMLElement>('.pv-peak-batt')
    if (pvEl) pvEl.textContent = peakPv.toFixed(2)
    if (loadEl) loadEl.textContent = peakLoad.toFixed(2)
    if (battEl) battEl.textContent = peakBatt.toFixed(2)
  }

  function updateAxes(scale: Scale, chartHeight: number, top: number, bottom: number) {
    const range = scale.max - scale.min || 1
    const plotHeight = bottom - top
    yAxis.innerHTML = scale.ticks
      .map((value, index) => {
        const y = top + (1 - (value - scale.min) / range) * plotHeight
        const cls = index === 0 ? 'font-medium text-foreground/60' : 'text-muted-foreground'
        const label = `${value < 0 ? '−' : ''}${numberFormat.format(Math.abs(value))}`
        return `<span class="absolute right-0 text-right text-[9px] leading-none ${cls}" style="top:${((y / chartHeight) * 100).toFixed(2)}%;transform:translateY(-50%)">${label}</span>`
      })
      .join('')

    const span = viewport.end - viewport.start
    const interval = tickInterval(span, plotRight - plotLeft)
    let timestamp = Math.ceil((viewport.start + BANGKOK_OFFSET_MS) / interval) * interval - BANGKOK_OFFSET_MS
    const labels: string[] = []
    while (timestamp < viewport.end) {
      const ratio = (timestamp - viewport.start) / span
      const isDayTick = interval >= DAY_MS
      const crossesDay = bangkokISODateAt(viewport.start) !== bangkokISODateAt(viewport.end - 1)
      const label = isDayTick ? shortDayFormat.format(timestamp) : crossesDay ? `${shortDayFormat.format(timestamp)} · ${timeFormat.format(timestamp)}` : timeFormat.format(timestamp)
      const translate = ratio < 0.02 ? '' : ratio > 0.98 ? '-translate-x-full' : '-translate-x-1/2'
      labels.push(`<span class="absolute ${translate} whitespace-nowrap" style="left:${(ratio * 100).toFixed(2)}%">${label}</span>`)
      timestamp += interval
    }
    xAxis.innerHTML = labels.join('')
    xAxis.style.paddingLeft = '0'
    xAxis.style.paddingRight = '0'
    xAxis.style.marginLeft = `${plotLeft}px`
    xAxis.style.marginRight = `${Math.max(svgWidth - plotRight, 0)}px`
    visibleRange.textContent = formatVisibleRange(viewport)
  }

  function draw() {
    const width = wrap.clientWidth
    const height = wrap.clientHeight
    if (width <= 0 || height <= 0) return

    const [left, top, rightInset, bottomInset] = [4, 18, 8, 28]
    const right = width - rightInset
    const bottom = height - bottomInset
    const plotHeight = bottom - top
    svgWidth = width
    plotLeft = left
    plotRight = right
    visiblePoints = cachedPoints(viewport, PATH_MARGIN_MS)
    const summaryPoints = visiblePoints.filter((point) => point.timestamp >= viewport.start && point.timestamp <= viewport.end)
    const scale = computeScale(summaryPoints)
    const scaleRange = scale.max - scale.min || 1
    const span = viewport.end - viewport.start
    const x = (timestamp: number) => left + ((timestamp - viewport.start) / span) * (right - left)
    const y = (value: number) => top + (1 - Math.max(0, Math.min(1, (value - scale.min) / scaleRange))) * plotHeight
    const maxRenderPoints = Math.max(Math.floor((right - left) * 2), 240)

    const pvPaths = splitPaths(visiblePoints, maxRenderPoints, (point) => point.pv, x, y)
    const loadPaths = splitPaths(visiblePoints, maxRenderPoints, (point) => point.load, x, y)
    const battPaths = splitPaths(visiblePoints, maxRenderPoints, (point) => point.batt, x, y)
    const gridPaths = splitPaths(visiblePoints, maxRenderPoints, (point) => point.grid, x, y)
    const lineMarkup = (paths: { x: number; y: number }[][], attributes: string) => paths.map((path) => `<path d="${svgPathFromPoints(path)}" ${attributes}/>`).join('')
    const areaMarkup = (paths: { x: number; y: number }[][], fill: string) =>
      paths.map((path) => `<path d="${svgPathFromPoints(path)} L ${path.at(-1)!.x.toFixed(1)},${bottom} L ${path[0].x.toFixed(1)},${bottom} Z" fill="${fill}"/>`).join('')
    const gridLines = scale.ticks.map((value) => y(value).toFixed(1))

    svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
    svg.innerHTML = `
      <defs>
        <linearGradient id="pv-grad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="var(--chart-2)" stop-opacity="0.35"/><stop offset="100%" stop-color="var(--chart-2)" stop-opacity="0"/></linearGradient>
        <linearGradient id="load-grad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="var(--destructive)" stop-opacity="0.2"/><stop offset="100%" stop-color="var(--destructive)" stop-opacity="0"/></linearGradient>
        <clipPath id="pv-clip"><rect x="${left}" y="${top}" width="${right - left}" height="${plotHeight}"/></clipPath>
      </defs>
      <line x1="${left}" x2="${right}" y1="${bottom}" y2="${bottom}" stroke="var(--border)" stroke-opacity="0.8" stroke-width="0.5"/>
      ${gridLines.map((gridY) => `<line x1="${left}" x2="${right}" y1="${gridY}" y2="${gridY}" stroke="var(--border)" stroke-opacity="0.8" stroke-width="0.5" stroke-dasharray="2 4"/>`).join('')}
      <g clip-path="url(#pv-clip)">
        ${areaMarkup(pvPaths, 'url(#pv-grad)')}
        ${lineMarkup(pvPaths, 'fill="none" stroke="var(--chart-2)" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"')}
        ${areaMarkup(loadPaths, 'url(#load-grad)')}
        ${lineMarkup(loadPaths, 'fill="none" stroke="var(--destructive)" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"')}
        ${lineMarkup(battPaths, 'class="mobile-chart-detail" fill="none" stroke="var(--chart-3)" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"')}
        ${lineMarkup(gridPaths, 'class="mobile-chart-detail" fill="none" stroke="var(--chart-4)" stroke-width="0.75" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="5 2" stroke-opacity="0.7"')}
      </g>
      <line class="pv-crosshair" x1="0" x2="0" y1="${top}" y2="${bottom}" stroke="var(--foreground)" stroke-opacity="0.2" stroke-width="0.5" visibility="hidden"/>
      <rect x="${left}" y="${top}" width="${right - left}" height="${plotHeight}" fill="transparent"/>`

    crosshair = svg.querySelector('.pv-crosshair')
    updateAxes(scale, height, top, bottom)
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
    tip.querySelector<HTMLElement>('.pv-tip-hour')!.textContent = `${shortDayFormat.format(point.timestamp)} · ${timeFormat.format(point.timestamp)} น.`
    tip.querySelector<HTMLElement>('.pv-tip-pv')!.textContent = `${point.pv.toFixed(2)} kW`
    tip.querySelector<HTMLElement>('.pv-tip-load')!.textContent = `${point.load.toFixed(2)} kW`
    tip.querySelector<HTMLElement>('.pv-tip-batt')!.textContent = point.batt > 0.05 ? `+${point.batt.toFixed(2)} kW` : point.batt < -0.05 ? `−${Math.abs(point.batt).toFixed(2)} kW` : '0.00 kW'
    tip.querySelector<HTMLElement>('.pv-tip-grid')!.textContent = point.grid < -0.01 ? `${Math.abs(point.grid).toFixed(2)} kW` : 'ไม่ซื้อ'
    tip.classList.remove('hidden')
    tip.style.left = `${Math.min(clientX + 14, window.innerWidth - 180)}px`
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
    socket = io(config.socketUrl, { transports: ['websocket'] })
    socket.on('connect', () => socket?.emit('subscribe', SOCKET_CHANNELS.solarFiveMin))
    socket.on(SOCKET_CHANNELS.solarFiveMin, (payload: FiveMinChartPayload) => {
      dayCache.set(config.today, pointsFromPayload(config.today, payload))
      scheduleDraw()
    })
  }

  window.addEventListener(
    'pagehide',
    () => {
      disposed = true
      resizeObserver.disconnect()
      socket?.disconnect()
      if (animationFrame) cancelAnimationFrame(animationFrame)
    },
    { once: true },
  )
}
