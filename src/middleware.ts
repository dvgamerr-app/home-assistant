import { defineMiddleware } from 'astro:middleware'
import { auth } from '@/lib/auth'

const PUBLIC = ['/login', '/no-permission', '/api/auth']

export const onRequest = defineMiddleware(async ({ request, redirect }, next) => {
  const { pathname } = new URL(request.url)
  if (PUBLIC.some((p) => pathname.startsWith(p))) {
    const response = await next()
    if (response.headers.get('content-type')?.includes('text/html')) {
      response.headers.set('content-type', 'text/html; charset=utf-8')
    }
    return response
  }

  const session = await auth.api.getSession({ headers: request.headers })
  if (!session) return redirect('/login')

  const allowed = (process.env.ALLOWED_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean)
  if (allowed.length > 0 && !allowed.includes(session.user.email ?? '')) return redirect('/no-permission')

  const response = await next()
  if (response.headers.get('content-type')?.includes('text/html')) {
    response.headers.set('content-type', 'text/html; charset=utf-8')
  }
  return response
})
