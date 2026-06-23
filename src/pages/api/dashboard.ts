import type { APIRoute } from 'astro'
import { getAll } from '@/lib/solar-data'

export const GET: APIRoute = async () => {
  const data = await getAll()
  return Response.json(data)
}
