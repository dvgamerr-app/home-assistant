import { defineMiddleware } from 'astro:middleware'
import { auth } from '@/lib/auth'
import { isEmailAllowed } from '@/lib/config'

// `/api/qr` ต้อง public เพราะ LINE fetch รูปในการ์ดเองโดยไม่มี session
// ป้องกันด้วยลายเซ็น HMAC ใน token แทน (ดู src/lib/bill-qr.ts)
//
// `/api/health` กับ `/offline` เป็นส่วนของ PWA: ตัวแรกคือ probe ที่เบราว์เซอร์ใช้ถาม
// ว่าเซิร์ฟเวอร์ยังตอบอยู่ไหม (ต้องตอบได้แม้ยังไม่ login) ตัวหลังคือหน้าสำรองที่
// service worker เก็บไว้ตั้งแต่ตอน install ซึ่งเป็นจังหวะที่ยังไม่มี session ก็ได้
const PUBLIC = ['/login', '/two-factor', '/no-permission', '/api/auth', '/api/qr', '/api/health', '/offline']

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
