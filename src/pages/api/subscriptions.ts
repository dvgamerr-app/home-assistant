import type { APIRoute } from 'astro'
import { auth } from '@/lib/auth'
import { config, isEmailAllowed } from '@/lib/config'
import { getSubscriptions, saveSubscriptionData } from '@/lib/subscription-store'
import { SubscriptionError } from '@/lib/subscriptions'
import { logger } from '@/lib/logger'

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } })

const handle: APIRoute = async ({ request, url }) => {
  try {
    const session = await auth.api.getSession({ headers: request.headers })
    if (!session) return json({ error: 'กรุณาเข้าสู่ระบบใหม่' }, 401)
    if (!isEmailAllowed(session.user.email)) return json({ error: 'บัญชีนี้ไม่มีสิทธิ์เข้าถึงข้อมูลบ้าน' }, 403)
    if (request.method === 'GET') return json(await getSubscriptions())

    const origin = request.headers.get('origin')
    if (!origin || ![url.origin, new URL(config.appBaseUrl).origin].includes(origin)) return json({ error: 'ไม่อนุญาตคำขอจากเว็บไซต์อื่น' }, 403)
    if (!request.headers.get('content-type')?.startsWith('application/json')) return json({ error: 'รูปแบบข้อมูลไม่ถูกต้อง' }, 415)
    const raw = await request.text()
    if (raw.length > 16000) return json({ error: 'ข้อมูลยาวเกินไป' }, 413)
    let body: Record<string, unknown>
    try {
      const value = JSON.parse(raw)
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error()
      body = value
    } catch {
      return json({ error: 'รูปแบบข้อมูลไม่ถูกต้อง' }, 400)
    }
    if (body.kind !== 'account' && body.kind !== 'subscription') return json({ error: 'ประเภทรายการไม่ถูกต้อง' }, 400)
    const result = await saveSubscriptionData(body.kind, body, session.user.id, request.method === 'PATCH')
    return json(result, request.method === 'POST' ? 201 : 200)
  } catch (error) {
    if (error instanceof SubscriptionError) return json({ error: error.message }, error.status)
    logger.error({ err: error }, 'subscription request failed')
    return json({ error: 'ยังเชื่อมต่อข้อมูล Subscription ไม่ได้ กรุณาลองใหม่อีกครั้ง' }, 503)
  }
}

export const GET = handle
export const POST = handle
export const PATCH = handle
