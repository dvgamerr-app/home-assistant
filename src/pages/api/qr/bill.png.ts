import type { APIRoute } from 'astro'
import QRCode from 'qrcode'
import { decodeQrToken } from '@/lib/bill-qr'

/**
 * รูป QR จ่ายบิลสำหรับใส่ในการ์ด LINE
 *
 * เปิด public (ดู PUBLIC ใน src/middleware.ts) เพราะ LINE ต้อง fetch รูปเองจาก
 * ภายนอกและไม่มี session — กันการเดา/ปลอมด้วย HMAC ใน token แทน
 * payload ฝังอยู่ในตัว token จึงไม่แตะ DB และ enumerate เลขบิลไม่ได้
 */
export const GET: APIRoute = async ({ url }) => {
  const token = url.searchParams.get('t')
  if (!token) return new Response('missing token', { status: 400 })

  // ลายเซ็น HMAC เป็นด่านความปลอดภัยเดียวที่ต้องผ่าน — ไม่เช็ค CRC เพราะรูปแบบจริง
  // ของบิล (`|<biller>\r...`) ไม่มี CRC ต่างจาก EMVCo · ไม่บอกสาเหตุที่ปฏิเสธ
  // เพื่อไม่ให้งมหา token ที่ใช้ได้
  const payload = decodeQrToken(token)
  if (!payload) return new Response('not found', { status: 404 })

  const png = await QRCode.toBuffer(payload, {
    type: 'png',
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 600,
    color: { dark: '#2F2B27', light: '#FFFFFF' },
  })

  return new Response(new Uint8Array(png), {
    headers: {
      'Content-Type': 'image/png',
      // การ์ดใน LINE อยู่ในแชทยาว — ให้ cache ได้นาน แต่ห้าม cache ที่ proxy กลาง
      'Cache-Control': 'private, max-age=31536000, immutable',
    },
  })
}
