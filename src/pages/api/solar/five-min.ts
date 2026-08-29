import type { APIRoute } from 'astro'
import { cacheData } from '@/lib/data-cache'
import { get5Min } from '@/lib/db'
import { formatISODate, getBangkokISODate, isISODate, parseISODate } from '@/lib/date'
import { dayCacheTtl, fiveMinCacheKey, SYSTEM } from '@/lib/solar-data'
import { buildFiveMinChartPayload, toFiveMinChartPoints } from '@/lib/solar-fivemin'

export const GET: APIRoute = async ({ url }) => {
  const date = url.searchParams.get('date')
  const today = getBangkokISODate()

  if (!isISODate(date) || formatISODate(parseISODate(date)) !== date || date < SYSTEM.installDate || date > today) {
    return Response.json({ error: 'date must be within the available solar history' }, { status: 400 })
  }

  // key + TTL มาจาก solar-data เพื่อไม่ให้สองที่ตั้ง TTL ต่างกันบน cache key เดียวกัน
  const samples = await cacheData(fiveMinCacheKey(date), dayCacheTtl(date), () => get5Min(parseISODate(date)))
  const payload = buildFiveMinChartPayload(toFiveMinChartPoints(samples))

  return Response.json(payload, {
    headers: {
      'Cache-Control': date === today ? 'private, max-age=15' : 'private, max-age=21600',
    },
  })
}
