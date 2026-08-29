# AGENTS.md

Home-assistant dashboard — รวบรวมข้อมูลในบ้าน (ตอนนี้คือระบบโซลาร์/พลังงาน) มาแสดงเป็นสถิติ UI ภาษาไทย ดีไซน์โทน "luxury residence" (serif น้ำหนักเบา, โทนอบอุ่น, เส้นบางแทนเงา)

## Stack

- **Astro 7** — `output: 'server'`, adapter `@astrojs/node` (standalone) รันผลลัพธ์ด้วย bun. หน้าทุกหน้า render ฝั่ง server ต่อ request
- **Svelte 5** (runes) — ใช้เป็น island เฉพาะส่วนที่ต้องโต้ตอบเท่านั้น
- **Tailwind v4** — config แบบ CSS-first (`@theme` ใน `src/styles/global.css`), ผ่าน `@tailwindcss/vite` ไม่ใช่ integration เก่า
- **@lucide/svelte** — ไอคอน, import ราย icon (`@lucide/svelte/icons/<name>`)
- **better-auth v1.6** — auth in-project, email+password + GitHub OAuth. config: `src/lib/auth.ts`. API route: `src/pages/api/auth/[...all].ts`
- **Better Auth 2FA** — TOTP + recovery codes ผ่าน `twoFactor` plugin; enrollment อยู่หน้า `/settings`, challenge อยู่ `/two-factor`; schema เพิ่มใน migration `002_two_factor.ts`
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
SOCKET_POLL_MS        # ตรวจ source timestamp สำหรับ socket (default 60000; emit เมื่อข้อมูลเปลี่ยน)
ENERGY_ALERT_POLL_MS  # รอบตรวจ Energy Lib alert (default 300000 ตาม cadence ข้อมูล ~5 นาที)
UTILITY_ALERT_POLL_MS # รอบตรวจบิลค่าไฟ/น้ำ (default 3600000)
MEA_BILL_DAY          # วันที่ค่าไฟเข้าในแต่ละเดือน (default 12)
MWA_BILL_DAY          # วันที่ค่าน้ำเข้าในแต่ละเดือน (default 22)
UTILITY_ALERT_GRACE_DAYS # จำนวนวันเผื่อ collector ส่งช้า (default 1)
SOLAR_DEVICE_ID       # device_id ใน stash.solar_record
MEA_HOUSE_CA          # เลข CA ของบ้านใน stash.mea_electric
MWA_ACCOUNT_CODE      # account_code ใน stash.mwa_account (ถ้าไม่ตั้ง ใช้บัญชีแรก)
GITHUB_CLIENT_ID/SECRET  # สำหรับ GitHub OAuth (optional)
LINE_NOTICE_URL       # endpoint กลางสำหรับส่ง alert เข้า LINE
LINE_NOTICE_API_KEY   # API key ของ LINE Manager (เก็บใน secret/env เท่านั้น)
ENERGY_LIB_AVATAR_URL # avatar หลัก: https://home.ourkk.com/lib.png
ENERGY_ALERT_BATTERY_RESERVE_PCT # ค่า reserve สำหรับ alert หลัง 09:00 (default 15)
ENERGY_ALERT_BATTERY_EVENING_MAX_PCT # หลัง 18:00 แจ้งเมื่อ SOC ยังไม่ต่ำกว่าค่านี้ (default 95)
ENERGY_ALERT_SOLAR_BASELINE_MONTH  # เดือนฐาน MPPT รูปแบบ YYYY-MM (default = ก.ค. ล่าสุด)
ENERGY_ALERT_SOLAR_MIN_RATIO       # สัดส่วนขั้นต่ำเทียบฐาน (default 0.2)
```

## คำสั่ง

```bash
bun run dev       # astro dev (vite plugin ใน astro.config spawn server/socket.mjs ให้เอง)
bun run build     # astro build (server + client)
bun run preview   # bun ./dist/server/entry.mjs  (รันผลลัพธ์ที่ build)
bun run check     # astro check (typecheck .astro/.svelte/.ts)
bun run lint      # eslint .
bun run format    # prettier --check .  (format:fix = เขียนทับ)
bun test          # bun test (chart / chart-viewport / battery / energy-alerts / utility-bill-alerts / line-transport)
bun run migration:run   # รัน Kysely migrations สำหรับ auth DB
bun run dev:socket      # รัน socket.io server แยก process (ใช้คู่กับ preview)
```

## DB Schema (collector DB — `stash` schema)

```sql
stash.solar_record   -- EAV: (device_id, attr, value, recorded_at)
stash.mea_electric   -- บิลและสถานะชำระ MEA: (month YYYYMM, kwh, paid, payment_status, paid_at, due_date, outstanding_amount, payment_amount, payment_channel)
stash.mea_meter      -- มิเตอร์: (month YYYYMM, reading, recorded_at)
stash.mwa_account    -- บัญชีผู้ใช้น้ำ MWA: (account_code, branch, meter size, status)
stash.mwa_water      -- รอบบิลน้ำ MWA: (period_year/month, consumption, current_read_date, amounts)
```

pivot EAV: `DISTINCT ON (attr) ORDER BY attr, recorded_at DESC` ดึงค่าล่าสุดต่อ attribute

## โครงสร้าง

- `src/pages/` — `index.astro` (ภาพรวม slim) · `electricity/` (`load` การใช้ไฟ / `solar` ผลิตไฟ / `bill` ค่าไฟ / `water` การใช้น้ำ, สลับด้วย `ElectricityNav`; `index` redirect ไป `load`) · `settings.astro` · `two-factor.astro` · `login.astro` · `no-permission.astro` · `api/auth/[...all].ts`
- `src/middleware.ts` — ตรวจ session + allowlist ทุก request ยกเว้น `/login`, `/no-permission`, `/api/auth`
- `src/layouts/Layout.astro` — shell, โหลดฟอนต์ + script set theme กัน flash
- `src/components/` — `.astro` static เป็นหลัก, Svelte islands: `LiveClock.svelte` · `ThemeToggle.svelte` · `LogoutButton.svelte` · `LoginForm.svelte` · `EnergyFlow.svelte` (socket.io) · `SolarStatusCards.svelte` (socket.io) · `ui/DatePicker.svelte`. กราฟอยู่ใน `components/charts/`
- `src/lib/` — `config.ts` (**อ่าน ENV ที่เดียว** — LINE / poll interval / เกณฑ์ alert / allowlist; อย่าอ่าน `process.env` ตรงๆ ในไฟล์อื่น), `solar-data.ts` (async `getAll()`/`getMonthLoad()` ดึงข้อมูลจาก db + `dayCacheTtl()`/`fiveMinCacheKey()`), `db.ts` (postgres.js queries), `solar-fivemin.ts` (payload กราฟ 5 นาที + `toFiveMinChartPoints()` ใช้ร่วมกับ socket server/API), `alert-worker.ts` (`createAlertWorker()` + `runAlertChecks()` — โครง cycle ที่แยก error ต่อ check), `energy-alerts.ts` (เฉพาะ Energy Lib: device/battery/solar), `utility-bill-alerts.ts` (เฉพาะบิลค่าไฟ/ค่าน้ำ), `line-flex.ts` (token + primitive ของ LINE Flex card), `line-transport.ts` (`sendLineMessages()` + `LineNoticeError` แยก retryable), `auth.ts` (better-auth config), `electricity.ts` (MEA bill formula + `thb()`/`num()`/`formatBillMonth()` + ชื่อเดือนไทย), `payment-status.ts` (`classifyMeaPayment()`/`classifyMwaPayment()` — ตีความสถานะชำระที่เดียว), `chart.ts` (`svgPathFromPoints`/`svgLine`/`svgArea`/`svgAreaFromPoints`/`svgStackedBars`/`clamp01`), `date.ts` (วันที่ Bangkok), `socket.ts` (channel + `getSocketUrl`), `logger.ts` (pino)
- `src/db/` — `auth-db.ts` (Kysely instance) · `migrate.ts` · `migrations/`
- `server/socket.mjs` — socket.io server, poll ทุก 60s แล้ว broadcast ตาม channel ที่ client subscribe (`live`, `solar:fivemin`) พร้อมรัน Energy Lib worker และ utility bill worker แยกกัน
- `src/styles/global.css` — design tokens (oklch, light/dark), font, tracking-luxury, `.legend-dot`
- `docs/design-system.html` — design-system reference เปิดในเบราว์เซอร์ได้เลย, token sync กับ global.css

## ข้อตกลง (สำคัญเวลาแก้)

- **Static ก่อน:** เขียนเป็น `.astro` เว้นแต่ต้องโต้ตอบจริงค่อยทำเป็น Svelte island (`client:load`). icon ของ lucide render เป็น SVG static ใน `.astro` ได้ ไม่ต้อง hydrate
- **Design:** หัวข้อ/ตัวเลขเด่นใช้ `font-serif font-light`; label พิมพ์ใหญ่ใช้ `text-[10px] uppercase tracking-luxury text-muted-foreground`; การ์ดใช้ `border border-border/70 bg-card` (เส้นบาง ไม่ใช้ shadow); สีอ้างอิง token `--chart-1..5` / `text-chart-*`
- **กราฟ:** เป็น SVG ที่ประกอบเองผ่าน helper ใน `chart.ts` (อย่าเพิ่ม charting lib). เส้นโค้งใช้ `svgPathFromPoints`/`svgLine` ตัวเดียวทั้ง server และ client script, สีอ้าง `var(--chart-*)`, แนบ legend ด้วย `LegendRow` + `.legend-dot`
- **แกน Y ของกราฟ:** ใช้ `ui/ChartYAxis.astro` และคำนวณ `topPct` จากตำแหน่ง gridline จริงเสมอ — **ห้าม hardcode `top:NN%`** (เคยทำให้ป้ายของ `GridDependencyChart` เลื่อนจากเส้นถึง 45px). ฝั่ง client ต้องใช้ความสูงที่วัดได้ (`clientHeight`) ไม่ใช่ค่าคงที่
- **Props ของ `.astro`:** ประกาศ `interface Props` / `type Props` แล้วอ่าน `Astro.props` ตรงๆ — **อย่าใช้ `Astro.props as ...`** เพราะ cast ทำให้ `astro check` ไม่จับ prop ที่ลืมส่ง
- **ข้อมูล:** ตัวเลขทั้งหมดมาจาก `src/lib/solar-data.ts` ผ่าน `await getAll()` (ดึงจาก DB จริง). แก้สมมติฐานระบบที่ object `SYSTEM` ที่หัวไฟล์. query หลายตัวใน `getAll()` ใช้ `Promise.allSettled` — slot ที่พังจะ log แล้ว fallback ไม่ทำให้หน้าเว็บ 500 ทั้งหน้า
- **Alert:** เพิ่ม check ใหม่ให้ผ่าน `runAlertChecks()` เสมอ เพื่อให้ check หนึ่งพัง (เช่น LINE ตอบ 403) ไม่ทำให้ check ที่เหลือไม่ถูกรัน
- **ENV:** อ่านผ่าน `src/lib/config.ts` เท่านั้น (มี clamp + default อยู่ที่เดียว)
- **`astro dev` เท่านั้นที่ spawn socket server:** ผ่าน hook `astro:server:start` ใน `astro.config.mjs` — อย่าย้ายกลับไปใช้ vite `configureServer` เพราะ `astro check`/`astro build` ก็สร้าง vite server ทำให้ typecheck ไปยิง LINE notice จริง
- **Lucide + Astro JSX:** Svelte 5 `Component<Props>` ทำให้ TypeScript ใช้ `ComponentInternals` เป็น props แทน `Props`. แก้ด้วย `LibraryManagedAttributes` ใน `src/env.d.ts`. HTML attr literals เช่น `type="radio"` ต้องเขียน `type={"radio" as const}` ในไฟล์ที่ error
- **ภาษา:** UI เป็นไทยสุภาพ เน้นความหมายต่อเจ้าของบ้าน ตัวเลขมาพร้อมบริบท
- **Commit:** conventional commits (husky + commitlint บังคับ), `pre-commit` รัน lint-staged (prettier + eslint). **ห้ามใส่ `Co-Authored-By`** หรือ signature ใดๆ
