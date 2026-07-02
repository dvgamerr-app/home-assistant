# AGENTS.md

Home-assistant dashboard — รวบรวมข้อมูลในบ้าน (ตอนนี้คือระบบโซลาร์/พลังงาน) มาแสดงเป็นสถิติ UI ภาษาไทย ดีไซน์โทน "luxury residence" (serif น้ำหนักเบา, โทนอบอุ่น, เส้นบางแทนเงา)

## Stack

- **Astro 7** — `output: 'server'`, adapter `@astrojs/node` (standalone) รันผลลัพธ์ด้วย bun. หน้าทุกหน้า render ฝั่ง server ต่อ request
- **Svelte 5** (runes) — ใช้เป็น island เฉพาะส่วนที่ต้องโต้ตอบเท่านั้น
- **Tailwind v4** — config แบบ CSS-first (`@theme` ใน `src/styles/global.css`), ผ่าน `@tailwindcss/vite` ไม่ใช่ integration เก่า
- **@lucide/svelte** — ไอคอน, import ราย icon (`@lucide/svelte/icons/<name>`)
- **better-auth v1.6** — auth in-project, email+password + GitHub OAuth. config: `src/lib/auth.ts`. API route: `src/pages/api/auth/[...all].ts`
- **Kysely v0.29** — migration runner สำหรับ auth DB (`src/db/auth-db.ts`, migrations ใน `src/db/migrations/`). รัน: `bun run migration:run`
- **pg v8** — Postgres dialect ให้ Kysely (auth tables เท่านั้น)
- **postgres.js v3** — query ข้อมูล solar/MEA จาก collector DB (`src/lib/db.ts`)
- **socket.io v4** — realtime server (`server/socket.mjs`) port จาก `SOCKET_PORT`, channel `live` + `solar:fivemin` (นิยามใน `src/lib/socket.ts`). ฝั่ง client: `EnergyFlow.svelte` · `SolarStatusCards.svelte` · script ใน `ProductionCurve.astro`/`SolarProductionRateCurve.astro`
- **pino + pino-pretty** — logging (`src/lib/logger.ts`)

แพ็กเกจ/รันด้วย **bun** เสมอ

## ENV ที่ต้องตั้ง (ดู `.env.example`)

```
DATABASE_URL          # collector DB (postgres.js) — stash schema
AUTH_DATABASE_URL     # auth DB (Kysely/pg) — better_auth schema
BETTER_AUTH_SECRET    # random secret สำหรับ better-auth
APP_BASE_URL          # base URL ของเว็บ (ใช้ทั้ง better-auth + socket URL ตอน production)
ALLOWED_EMAILS        # comma-separated อีเมลที่อนุญาต (ถ้าไม่ตั้ง = ไม่กรอง)
SOCKET_PORT           # port socket.io server (default 3000)
SOLAR_DEVICE_ID       # device_id ใน stash.solar_record
MEA_HOUSE_CA          # เลข CA ของบ้านใน stash.mea_electric
GITHUB_CLIENT_ID/SECRET  # สำหรับ GitHub OAuth (optional)
```

## คำสั่ง

```bash
bun run dev       # astro dev (vite plugin ใน astro.config spawn server/socket.mjs ให้เอง)
bun run build     # astro build (server + client)
bun run preview   # bun ./dist/server/entry.mjs  (รันผลลัพธ์ที่ build)
bun run check     # astro check (typecheck .astro/.svelte/.ts)
bun run lint      # eslint .
bun run format    # prettier --check .  (format:fix = เขียนทับ)
bun test          # bun test (มี src/lib/chart.test.ts)
bun run migration:run   # รัน Kysely migrations สำหรับ auth DB
bun run dev:socket      # รัน socket.io server แยก process (ใช้คู่กับ preview)
```

## DB Schema (collector DB — `stash` schema)

```sql
stash.solar_record   -- EAV: (device_id, attr, value, recorded_at)
stash.mea_electric   -- บิลไฟ MEA: (month YYYYMM, kwh, paid, recorded_at)
stash.mea_meter      -- มิเตอร์: (month YYYYMM, reading, recorded_at)
```

pivot EAV: `DISTINCT ON (attr) ORDER BY attr, recorded_at DESC` ดึงค่าล่าสุดต่อ attribute

## โครงสร้าง

- `src/pages/` — `index.astro` (ภาพรวม slim) · `electricity/` (`load` การใช้ไฟ / `solar` ผลิตไฟ / `bill` ค่าไฟ, สลับด้วย `ElectricityNav`; `index` redirect ไป `load`) · `login.astro` · `no-permission.astro` · `api/auth/[...all].ts`
- `src/middleware.ts` — ตรวจ session + allowlist ทุก request ยกเว้น `/login`, `/no-permission`, `/api/auth`
- `src/layouts/Layout.astro` — shell, โหลดฟอนต์ + script set theme กัน flash
- `src/components/` — `.astro` static เป็นหลัก, Svelte islands: `LiveClock.svelte` · `ThemeToggle.svelte` · `LogoutButton.svelte` · `LoginForm.svelte` · `EnergyFlow.svelte` (socket.io) · `SolarStatusCards.svelte` (socket.io) · `ui/DatePicker.svelte`. กราฟอยู่ใน `components/charts/`
- `src/lib/` — `solar-data.ts` (async `getAll()`/`getMonthLoad()` ดึงข้อมูลจาก db), `db.ts` (postgres.js queries), `solar-fivemin.ts` (payload กราฟ 5 นาที ใช้ร่วมกับ socket server), `auth.ts` (better-auth config), `electricity.ts` (MEA bill formula + `thb()`/`num()` + ชื่อเดือนไทย), `chart.ts` (`svgPathFromPoints`/`svgLine`/`svgArea`/`svgStackedBars`), `date.ts` (วันที่ Bangkok), `socket.ts` (channel + `getSocketUrl`), `logger.ts` (pino)
- `src/db/` — `auth-db.ts` (Kysely instance) · `migrate.ts` · `migrations/`
- `server/socket.mjs` — socket.io server, poll ทุก 60s แล้ว broadcast ตาม channel ที่ client subscribe (`live`, `solar:fivemin`)
- `src/styles/global.css` — design tokens (oklch, light/dark), font, tracking-luxury, `.legend-dot`
- `docs/design-system.html` — design-system reference เปิดในเบราว์เซอร์ได้เลย, token sync กับ global.css

## ข้อตกลง (สำคัญเวลาแก้)

- **Static ก่อน:** เขียนเป็น `.astro` เว้นแต่ต้องโต้ตอบจริงค่อยทำเป็น Svelte island (`client:load`). icon ของ lucide render เป็น SVG static ใน `.astro` ได้ ไม่ต้อง hydrate
- **Design:** หัวข้อ/ตัวเลขเด่นใช้ `font-serif font-light`; label พิมพ์ใหญ่ใช้ `text-[10px] uppercase tracking-luxury text-muted-foreground`; การ์ดใช้ `border border-border/70 bg-card` (เส้นบาง ไม่ใช้ shadow); สีอ้างอิง token `--chart-1..5` / `text-chart-*`
- **กราฟ:** เป็น SVG ที่ประกอบเองผ่าน helper ใน `chart.ts` (อย่าเพิ่ม charting lib). เส้นโค้งใช้ `svgPathFromPoints`/`svgLine` ตัวเดียวทั้ง server และ client script, สีอ้าง `var(--chart-*)`, แนบ legend ด้วย `LegendRow` + `.legend-dot`
- **ข้อมูล:** ตัวเลขทั้งหมดมาจาก `src/lib/solar-data.ts` ผ่าน `await getAll()` (ดึงจาก DB จริง). แก้สมมติฐานระบบที่ object `SYSTEM` ที่หัวไฟล์
- **Lucide + Astro JSX:** Svelte 5 `Component<Props>` ทำให้ TypeScript ใช้ `ComponentInternals` เป็น props แทน `Props`. แก้ด้วย `LibraryManagedAttributes` ใน `src/env.d.ts`. HTML attr literals เช่น `type="radio"` ต้องเขียน `type={"radio" as const}` ในไฟล์ที่ error
- **ภาษา:** UI เป็นไทยสุภาพ เน้นความหมายต่อเจ้าของบ้าน ตัวเลขมาพร้อมบริบท
- **Commit:** conventional commits (husky + commitlint บังคับ), `pre-commit` รัน lint-staged (prettier + eslint). **ห้ามใส่ `Co-Authored-By`** หรือ signature ใดๆ
