export type TimeRange = {
  start: number
  end: number
}

export type TimeBounds = {
  min: number
  max: number
}

export const MINUTE_MS = 60_000
export const HOUR_MS = 60 * MINUTE_MS
export const DAY_MS = 24 * HOUR_MS
export const BANGKOK_OFFSET_MS = 7 * HOUR_MS

export function bangkokDayStart(isoDate: string) {
  const [year, month, day] = isoDate.split('-').map(Number)
  return Date.UTC(year, month - 1, day) - BANGKOK_OFFSET_MS
}

export function bangkokISODateAt(timestamp: number) {
  return new Date(timestamp + BANGKOK_OFFSET_MS).toISOString().slice(0, 10)
}

export function clampTimeRange(range: TimeRange, bounds: TimeBounds, minSpan: number, maxSpan: number): TimeRange {
  const available = Math.max(bounds.max - bounds.min, 1)
  const span = Math.min(Math.max(range.end - range.start, Math.min(minSpan, available)), Math.min(maxSpan, available))
  let start = range.start
  let end = start + span

  if (start < bounds.min) {
    start = bounds.min
    end = start + span
  }
  if (end > bounds.max) {
    end = bounds.max
    start = end - span
  }

  return { start, end }
}

export function panTimeRange(range: TimeRange, dragDeltaPx: number, plotWidth: number, bounds: TimeBounds): TimeRange {
  if (plotWidth <= 0) return range
  const span = range.end - range.start
  const shift = -(dragDeltaPx / plotWidth) * span
  return clampTimeRange({ start: range.start + shift, end: range.end + shift }, bounds, span, span)
}

export function zoomTimeRange(range: TimeRange, factor: number, anchorRatio: number, bounds: TimeBounds, minSpan: number, maxSpan: number): TimeRange {
  const ratio = Math.max(0, Math.min(1, anchorRatio))
  const span = range.end - range.start
  const nextSpan = Math.min(Math.max(span * factor, minSpan), maxSpan)
  const anchorTime = range.start + span * ratio

  return clampTimeRange(
    {
      start: anchorTime - nextSpan * ratio,
      end: anchorTime + nextSpan * (1 - ratio),
    },
    bounds,
    minSpan,
    maxSpan,
  )
}

export function datesInRange(range: TimeRange) {
  const dates: string[] = []
  let cursor = bangkokDayStart(bangkokISODateAt(range.start))
  const finalDay = bangkokDayStart(bangkokISODateAt(Math.max(range.start, range.end - 1)))

  while (cursor <= finalDay) {
    dates.push(bangkokISODateAt(cursor))
    cursor += DAY_MS
  }

  return dates
}
