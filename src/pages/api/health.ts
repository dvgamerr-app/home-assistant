import type { APIRoute } from 'astro'

/**
 * จุดตรวจ "เซิร์ฟเวอร์ยังตอบอยู่ไหม" ของฝั่งเบราว์เซอร์ (ดู src/lib/connectivity.ts)
 *
 * ตั้งใจให้เบาที่สุดและไม่แตะ DB — คำถามคือเน็ตถึงบ้านไหม ไม่ใช่ข้อมูลพร้อมไหม
 * และต้องอยู่นอก auth เพราะหน้า login ก็ต้องรู้สถานะเหมือนกัน
 */
export const GET: APIRoute = () =>
  Response.json(
    { ok: true, at: new Date().toISOString() },
    {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    },
  )
