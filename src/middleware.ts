import { defineMiddleware } from 'astro:middleware'
import { auth } from '@/lib/auth'
import { isEmailAllowed } from '@/lib/config'

// `/api/qr` ต้อง public เพราะ LINE fetch รูปในการ์ดเองโดยไม่มี session
// ป้องกันด้วยลายเซ็น HMAC ใน token แทน (ดู src/lib/bill-qr.ts)
const PUBLIC = ['/login', '/two-factor', '/no-permission', '/api/auth', '/api/qr']

export const onRequest = defineMiddleware(async ({ request, redirect }, next) => {
  const { pathname } = new URL(request.url)

  if (!PUBLIC.some((p) => pathname.startsWith(p))) {
    const session = await auth.api.getSession({ headers: request.headers })
    if (!session) return redirect('/login')

    // allowlist parse ครั้งเดียวใน config และเทียบแบบ case-insensitive
    // (เดิม split ทุก request และเทียบตรงตัว — ตัวพิมพ์ใหญ่ใน env ล็อกผู้ใช้ออก)
    if (!isEmailAllowed(session.user.email)) return redirect('/no-permission')
  }

  const response = await next()
  if (response.headers.get('content-type')?.includes('text/html')) {
    response.headers.set('content-type', 'text/html; charset=utf-8')
  }

  return response
})
