# PWA / โหมดออฟไลน์

ปัญหาที่แก้: `https://home.ourkk.com` รันอยู่ในบ้าน — เน็ตบ้านล่มเมื่อไหร่ เว็บก็เปิดไม่ขึ้นไปด้วย
ทั้งที่สิ่งที่เจ้าของบ้านอยากดูตอนนั้น (ค่าไฟ, ผลิตไฟวันนี้, เน็ตหลุดไปนานเท่าไหร่) เป็นข้อมูลที่
เพิ่งโหลดไปเมื่อไม่กี่นาทีก่อน

แนวทาง: ติดตั้งเป็น PWA + service worker เก็บสำเนา HTML ของทุกหน้าไว้ในเครื่อง เน็ตล่มแล้ว
ยังเปิดดูได้ตามปกติ เพียงแต่ **หยุดอัปเดตเรียลไทม์** และบอกให้ชัดว่าข้อมูลที่เห็นเป็นของเมื่อไหร่
พอเซิร์ฟเวอร์กลับมาตอบก็ต่อ socket และอัปเดตต่อเอง โดยผู้ใช้ไม่ต้องกดอะไร

## ไฟล์ที่เกี่ยวข้อง

| ไฟล์                             | หน้าที่                                                                       |
| -------------------------------- | ----------------------------------------------------------------------------- |
| `src/pwa/service-worker.js`      | **เทมเพลต** service worker (ไม่ได้ถูกรันตรง ๆ)                                 |
| `src/pwa/integration.mjs`        | Astro integration แทนค่า placeholder แล้วเขียน `dist/client/sw.js` ตอน build   |
| `src/lib/connectivity.ts`        | แหล่งความจริงเดียวว่า "ตอนนี้คุยกับบ้านได้ไหม" + ลงทะเบียน service worker      |
| `src/lib/offline-log.ts`         | นับเวลาที่เครื่องนี้เห็นว่าเน็ตหลุด แยกตามวัน (เวลาไทย) — pure ทั้งไฟล์        |
| `src/lib/live-socket.ts`         | socket.io ที่ต่อเมื่อออนไลน์ · ตัดเมื่อออฟไลน์                                 |
| `src/components/OfflineIndicator.svelte` | แถบสถานะออฟไลน์ + ปุ่มอัปเดตเวอร์ชัน (อยู่ใน `Layout.astro` ทุกหน้า)  |
| `src/components/InternetStatusCard.svelte` | การ์ด "สถานะอินเทอร์เน็ต" ของหน้า `/network`                        |
| `src/pages/offline.astro`        | หน้าสำรองตอนเปิดหน้าที่ยังไม่มีสำเนาในเครื่อง                                  |
| `src/pages/api/health.ts`        | จุดตรวจที่เบราว์เซอร์ใช้ probe (public, ไม่แตะ DB)                             |
| `public/manifest.webmanifest`    | manifest + shortcuts                                                           |
| `public/icon.svg`, `public/icons/` | ไอคอน — สร้าง PNG ด้วย `bun scripts/generate-icons.mjs`                      |

## กติกา cache ของ service worker

| cache           | ผูกเวอร์ชัน | ของที่เก็บ                            | กลยุทธ์                          |
| --------------- | ----------- | ------------------------------------- | -------------------------------- |
| `ourkk-shell`   | ✅          | `_astro/*`, ไอคอน, manifest, `/offline` | cache-first (ชื่อไฟล์มี hash)  |
| `ourkk-pages`   | ✅          | HTML ของแต่ละหน้า                      | network-first → fallback cache   |
| `ourkk-data`    | ✅          | `GET /api/*`                           | network-first → fallback cache   |
| `ourkk-runtime` | ❌          | ฟอนต์ Google + รูปใน `public/`         | stale-while-revalidate           |

**ไม่แตะเลย:** `/api/auth`, `/api/health`, `/api/qr`, `/socket.io`, ทุก request ที่ไม่ใช่ GET

ทำไม pages/data ต้องผูกเวอร์ชัน: HTML ที่ cache ไว้อ้างถึง chunk ที่ชื่อมี hash — ถ้า deploy ใหม่
แล้วยังเก็บ HTML เก่าไว้ chunk ที่มันเรียกจะถูกลบไปแล้วทั้งใน cache และบนเซิร์ฟเวอร์ หน้าจะยัง
render ได้แต่ island ไม่ hydrate ตอน `activate` (ซึ่งเกิดได้เฉพาะตอนโหลด `sw.js` ใหม่สำเร็จ =
ออนไลน์อยู่แน่นอน) จึงล้าง cache เก่าแล้ว **warm หน้าหลักกลับมาทันที** ในจังหวะเดียวกัน

## ลำดับเหตุการณ์ตอนเน็ตล่ม

1. `connectivity.ts` probe `/api/health` ทุก 30 วิ · พลาดแล้วถอยเป็น 2 → 4 → 8 → 15 → 30 วิ
   (`navigator.onLine === false` ตัดสินว่าออฟไลน์ได้เลยโดยไม่ต้องเสีย request)
2. service worker เจอ fetch ล้มก็ `postMessage` บอกหน้าเว็บทันที ไม่ต้องรอ probe รอบถัดไป
   — แต่เชื่อทันทีเฉพาะขา "ต่อได้" ขาหลุดยืนยันด้วย probe เสมอ เพราะ request เดียวที่ช้า
   ไม่ควรทำให้ทั้งหน้าเปลี่ยนเป็นออฟไลน์
3. `live-socket.ts` สั่ง `socket.disconnect()` — ไม่ปล่อยให้ socket.io ไล่ reconnect รัวกินแบต
4. `OfflineIndicator` ขึ้นแถบล่างจอ พร้อมเวลาที่ HTML หน้านี้ถูกบันทึกไว้ (ถามจาก service worker)
5. `offline-log.ts` เริ่มจับเวลา เก็บลง `localStorage` และตัดยอดใหม่เมื่อข้ามวัน
6. การ์ด "สถานะอินเทอร์เน็ต" ที่ `/network` เปลี่ยนเป็น **ขัดข้อง** และบวกเวลาที่จับได้เข้ากับยอด
   ของ collector — ยอดฝั่ง collector จะค้างอยู่ที่ค่าก่อนล่มเสมอ เพราะส่งค่าใหม่มาไม่ได้
7. พอ probe ผ่าน: socket ต่อกลับ, แถบเปลี่ยนเป็น "กลับมาออนไลน์แล้ว" พร้อมปุ่มโหลดหน้าใหม่

## ข้อควรรู้เวลาแก้

- **service worker ลงเฉพาะ production** — `astro dev` จะถอน registration เก่าทิ้งให้ด้วย
  (HMR กับ HTML ที่ถูก cache ตีกัน) ทดสอบจริงต้อง `bun run build && bun run preview`
- **เพิ่มหน้าใหม่ที่ต้องเปิดได้ตอนออฟไลน์** → เติมใน `WARM_URLS` ของ `service-worker.js`
  ไม่งั้นหน้านั้นจะถูกเก็บก็ต่อเมื่อผู้ใช้เคยเปิดตอนออนไลน์เท่านั้น
- **placeholder ในเทมเพลต** (`const VERSION = '__SW_VERSION__'`, `const PRECACHE_URLS = __SW_PRECACHE__`)
  ต้องคงรูปแบบเดิม — `integration.mjs` เทียบสตริงเป๊ะ ๆ และ throw ถ้าหาไม่เจอ ให้ build ล้มดังกว่า
  ปล่อย `sw.js` ที่พังขึ้น production
- **เพิ่ม route ที่ต้องเข้าถึงได้โดยไม่ login** ต้องไปเติมใน `PUBLIC` ของ `src/middleware.ts` ด้วย
  (`/offline` ถูก precache ตอน install ซึ่งอาจยังไม่มี session)
- **ออกจากระบบล้าง cache เสมอ** — `LogoutButton` เรียก `clearOfflineCaches()` ก่อนเด้งไป `/login`
  เพราะ HTML ที่เก็บไว้เป็นข้อมูลของบ้าน ไม่ควรค้างในเครื่องหลังออกจากระบบ
- **อย่าเขียน pointer/probe ใหม่** — ทุกที่ที่ต้องรู้สถานะออนไลน์ให้ `subscribeConnectivity()`
  และทุก socket ให้ผ่าน `createLiveSocket()` เพื่อให้เปิดปิดพร้อมกันทั้งหน้า

## ทดสอบด้วยมือ

```bash
bun run build && bun run preview
```

1. เปิด `http://localhost:4321` → DevTools › Application › Service Workers ต้องเห็น `sw.js` activated
2. เดินดูหน้า `/`, `/electricity/*`, `/network` หนึ่งรอบ (หรือรอ warm ตอน activate)
3. ปิดเซิร์ฟเวอร์ (Ctrl-C) แล้วรีเฟรช → หน้าต้องยังขึ้น + มีแถบ "ออฟไลน์" ล่างจอ
4. `/network` ต้องแสดง **ขัดข้อง** และนับเวลาที่หลุดเพิ่มขึ้นเรื่อย ๆ
5. เปิดเซิร์ฟเวอร์กลับ → ภายใน ~30 วิ แถบต้องเปลี่ยนเป็น "กลับมาออนไลน์แล้ว" และ EnergyFlow
   กลับไปขึ้น "เรียลไทม์" เอง

> DevTools › Network › Offline ก็ใช้จำลองได้ แต่ปิดเซิร์ฟเวอร์จริงตรงกับเคส "เน็ตบ้านล่ม" มากกว่า
> เพราะ `navigator.onLine` ยังเป็น `true` — ซึ่งเป็นเหตุผลที่ระบบนี้ probe เองแทนที่จะเชื่อ flag นั้น
