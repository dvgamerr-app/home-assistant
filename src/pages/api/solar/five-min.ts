import type { APIRoute } from 'astro'
import { cacheData } from '@/lib/data-cache'
import { get5Min } from '@/lib/db'
import { formatISODate, getBangkokISODate, isISODate, parseISODate } from '@/lib/date'
import { SYSTEM } from '@/lib/solar-data'
import { buildFiveMinChartPayload } from '@/lib/solar-fivemin'

const CURRENT_DAY_TTL_MS = 30_000
const HISTORICAL_TTL_MS = 6 * 60 * 60_000

export const GET: APIRoute = async ({ url }) => {
  const date = url.searchParams.get('date')
  const today = getBangkokISODate()

  if (!isISODate(date) || formatISODate(parseISODate(date)) !== date || date < SYSTEM.installDate || date > today) {
    return Response.json({ error: 'date must be within the available solar history' }, { status: 400 })
  }

  const ttl = date === today ? CURRENT_DAY_TTL_MS : HISTORICAL_TTL_MS
  const samples = await cacheData(`solar:five-min:${date}`, ttl, () => get5Min(parseISODate(date)))
  const payload = buildFiveMinChartPayload(
    samples.map((sample) => ({
      minuteOfDay: sample.minuteOfDay,
      pv: sample.pv,
      pv1: sample.pv1,
      pv2: sample.pv2,
      load: sample.load,
      batt: sample.batteryPower,
      grid: sample.gridPower,
    })),
  )

  return Response.json(payload, {
    headers: {
      'Cache-Control': date === today ? 'private, max-age=15' : 'private, max-age=21600',
    },
  })
}
