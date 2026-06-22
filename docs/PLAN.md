# PLAN — Home-Assistant: Auth + Real DB + Realtime + Page Restructure

อ้างอิงจากการสำรวจ 3 repo + การตัดสินใจที่ล็อกแล้ว

---

## สถาปัตยกรรมสรุป

```
                 ┌──────────────────────────────────────────┐
 browser ──SSR──▶│  Astro (Bun) :4321  home.ourkk.com        │
         ◀───────│  ├─ middleware: auth (better-auth local)  │──▶ Postgres ourkk (auth tables)
                 │  ├─ SSR pages: query solar/mea            │──▶ Postgres collector (stash.*)
                 │  └─ /api/auth/*  (better-auth handler)    │
                 └──────────────────────────────────────────┘
       ▲ socket.io
       │ (live push)
 ┌─────────────┐
 │ socket :3000│──poll 60s──▶ Postgres collector (snapshot ล่าสุด)
 └─────────────┘
```

- **better-auth อยู่ใน project นี้เลย** ไม่พึ่ง SSO ภายนอก
- DB `ourkk` = auth tables (Kysely migration) บน server เดียวกับ collector
- DB `collector` = `stash.solar_record`, `stash.mea_electric` (ข้อมูลพลังงาน)

---

## การตัดสินใจที่ล็อกแล้ว

| เรื่อง | ตัดสินใจ |
|---|---|
| Auth | better-auth ใน project นี้เลย (ไม่ใช้ SSO ภายนอก) |
| Domain | `home.ourkk.com` |
| Login method | Email+Password (local) + GitHub OAuth |
| Account linking | email เดียวกัน → link GitHub เข้า account เดิมอัตโนมัติ |
| Auth DB | Postgres DB ชื่อ `ourkk` (สร้างใหม่, Kysely migrations) |
| สิทธิ์เข้า dashboard | Email allowlist (`ALLOWED_EMAILS` ใน env) |
| Tab การใช้ไฟในบ้าน | แสดงโหลดรวมอย่างเดียว (ไม่มี sub-meter) |
| Socket | socket.io :3000 poll 60s |
| Logger | pino + pino-pretty (`LOG_FORMAT=text` dev, `json` prod) |

---

## Phase 0 — Dependencies, ENV, Logger

### deps (bun add)
```
better-auth           # auth (email+password + github + account linking)
kysely                # query builder + migrations (auth DB)
pg                    # Kysely Postgres dialect ← ใช้ pg ตัวนี้สำหรับ Kysely
postgres              # query builder สำหรับ solar/mea (raw SQL, เล็กกว่า)
socket.io             # realtime server
socket.io-client      # island client
pino                  # logger
pino-pretty           # dev formatter
```

### `.env` (เพิ่มจากที่มี)
```
# Auth DB (new)
AUTH_DATABASE_URL=postgres://r00t:***@10.203.1.91:5432/ourkk

# Solar/MEA DB (collector, อยู่แล้ว)
DATABASE_URL=postgres://r00t:***@10.203.1.91:5432/dev_collector
SOLAR_DEVICE_ID=                    # device_id ตัวบ้าน (query หาตอน Phase 1)
MEA_HOUSE_CA=                       # ca มิเตอร์บ้าน (query หาตอน Phase 1)

# Auth
BETTER_AUTH_SECRET=                 # random 32 bytes (bun -e "console.log(crypto.randomBytes(32).toString('hex'))")
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=

# Access control
ALLOWED_EMAILS=kananekt@scg.com     # comma-separated

# App
APP_BASE_URL=http://localhost:4321

# Socket
SOCKET_PORT=3000

# Logging
LOG_LEVEL=info
LOG_FORMAT=text                     # text=pino-pretty, json=raw
```

### `src/lib/logger.ts`
```ts
import pino from 'pino'
export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  ...(process.env.LOG_FORMAT === 'text'
    ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
    : {}),
})
```

---

## Phase 1 — DB Layer

### 1A — Auth DB: Kysely migrations (`src/db/auth/`)

สร้าง DB `ourkk` ก่อน:
```sql
CREATE DATABASE ourkk;
```

migration files ใน `src/db/migrations/`:
```
001_auth.ts   — user, session, account, verification tables
```

better-auth กับ Kysely dialect (Postgres):
```ts
// src/lib/auth.ts
import { betterAuth } from 'better-auth'
import { kyselyAdapter } from 'better-auth/adapters/kysely'
import { createAuthDb } from './auth-db'

export const auth = betterAuth({
  database: kyselyAdapter(createAuthDb(), { type: 'postgresql' }),
  secret: process.env.BETTER_AUTH_SECRET!,
  baseURL: process.env.APP_BASE_URL!,
  basePath: '/api/auth',
  emailAndPassword: { enabled: true },
  socialProviders: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    },
  },
  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: ['github'],   // GitHub link เข้า email account เดิมถ้า email ตรงกัน
    },
  },
})
```

migration script: `bun run db:migrate` → รัน Kysely migration ทุก file ใน `src/db/migrations/`

### 1B — Solar/MEA DB: postgres.js queries (`src/lib/db.ts`)

```ts
import postgres from 'postgres'
export const sql = postgres(process.env.DATABASE_URL!, { ssl: false, max: 5 })
```

queries ที่ต้องมี (เขียนเป็น function แยก):
- `getLiveSnapshot(deviceId)` — `DISTINCT ON (attr)` ล่าสุดต่อ attr → pivot เป็น LIVE object
- `getToday(deviceId)` — counters วันนี้
- `getHourly(deviceId, date)` — 24 จุด กลุ่มตามชั่วโมง (pv, load)
- `getMonthDays(deviceId, month)` — รายวันของเดือน
- `getMonths(deviceId, n=12)` — สรุปรายเดือน (aggregate daily)
- `getLifetime(deviceId)` — totalPowerGeneration, co2, ฯลฯ
- `getBills(ca, n=12)` — MEA บิล 12 เดือน (บ้านเท่านั้น)

**งานแรก:** query หา device_id บ้าน + ca มิเตอร์บ้าน + ชื่อ attr จริงใน solar_record ก่อนทำ mapping

### 1C — ลบ mock
`src/lib/solar-data.ts` — ลบ seeded RNG + mock objects ออกทั้งหมด เหลือ:
```ts
export const SYSTEM = {
  name: 'คุณกิ่งกาญจน์ 75/63',
  ratedPowerKw: 8,
  batteryCapacityKwh: 10,
  installDate: '2026-05-11',
  investmentTHB: 280000,
  serialNumber: 'LIBIPS08EEEAF618',
}
```
(ค่าคงที่ไม่มีใน DB)

`electricity.ts` และ `chart.ts` เก็บไว้ทั้งหมด

---

## Phase 2 — เสียบข้อมูลจริงเข้า pages

แต่ละ `.astro` page เรียก db.ts ใน frontmatter แทน import mock. props shape คงเดิม → แก้ component น้อยสุด

---

## Phase 3 — Realtime socket.io (:3000)

### `server/socket.mjs` (Bun process แยก)
- socket.io server port `SOCKET_PORT`
- CORS allow `APP_BASE_URL`
- poll `getLiveSnapshot()` ทุก 60s, emit เฉพาะเมื่อ `recorded_at` เปลี่ยน
- `socket.emit('live', snapshot)`
- log ด้วย pino

package.json scripts เพิ่ม:
```json
"dev:socket": "bun server/socket.mjs",
"dev:all": "bun --bun concurrently \"bun run dev\" \"bun run dev:socket\""
```

### client — island `LiveStats.svelte` (`client:load`)
- รับ snapshot เริ่มต้นจาก SSR props, subscribe socket อัปเดตตัวเลข hero/energy-flow

---

## Phase 4 — Auth (better-auth local) + หน้า "ไม่มีสิทธิ์"

### `src/pages/api/auth/[...all].ts`
```ts
import { auth } from '../../../lib/auth'
export const ALL = (ctx) => auth.handler(ctx.request)
```

### `src/middleware.ts`
```ts
import { auth } from './lib/auth'
const allowedEmails = (process.env.ALLOWED_EMAILS ?? '').split(',').map(e => e.trim())

export async function onRequest({ request, redirect, locals }) {
  // ข้าม /api/auth/* และ /no-permission
  if (request.url.includes('/api/auth') || request.url.includes('/no-permission')) return next()

  const session = await auth.api.getSession({ headers: request.headers })
  if (!session) return redirect('/api/auth/sign-in')        // ยังไม่ login
  if (!allowedEmails.includes(session.user.email))
    return redirect('/no-permission')                        // ไม่มีสิทธิ์

  locals.user = session.user
  return next()
}
```

### `src/pages/no-permission.astro`
- หน้าโทน luxury เดียวกัน: "ระบบนี้สำหรับเจ้าของบ้านเท่านั้น" + ปุ่ม sign-out

### `src/pages/login.astro` (ถ้า better-auth ไม่มี built-in UI)
- form email+password + ปุ่ม "เข้าสู่ระบบด้วย GitHub" → `/api/auth/sign-in/github`

---

## Phase 5 — ปรับโครงสร้างหน้า

### `index.astro` = Dashboard ภาพรวม (slim)
เก็บ: Hero (live 3 ค่า) · PaybackCard (ROI) · EnergyFlow · สรุปเดือนสั้น

### หน้าใหม่ `src/pages/electricity.astro` — "ระบบไฟฟ้า" (3 tabs = CSS radio ไม่มี JS)

**Tab 1 — การใช้ไฟในบ้าน**
- กราฟโหลดรวมรายชั่วโมงวันนี้ + รายวันของเดือน
- สถิติ: ใช้วันนี้, เดือนนี้, peak load, ช่วงเวลาใช้สูงสุด

**Tab 2 — ผลิตไฟ** (ย้ายมาจาก `analytics.astro`)
- BatteryCard · SystemHealth · PanelStrings · ProductionCurve (24h) · BatterySocChart · SelfSufficiencyChart · EnergyDistributionChart

**Tab 3 — การจ่ายค่าไฟ** (ข้อมูล MEA จริง)
- บิลรายเดือน 12 เดือน: `paid` จ่ายจริง, เทียบ "ถ้าไม่มี solar" (คำนวณจาก electricity.ts), ประหยัด, รายได้ขายคืน
- การ์ดสรุป: เดือนล่าสุด, ประหยัดสะสม, รายได้สะสม

### Nav
เพิ่มลิงก์ "ระบบไฟฟ้า" แทน Analytics

---

## Phase 6 — Cleanup

- ลบ `src/pages/analytics.astro` (รวมเข้า Tab 2)
- `bun run check` + `bun run lint` ผ่าน
- อัปเดต `AGENTS.md`: stack เพิ่ม postgres/kysely/socket.io/pino/better-auth, DB schema, คำสั่ง migrate
- อัปเดต `docs/design-system.html` ถ้า UI tokens เปลี่ยน
