// อ่าน ENV ที่เดียว ตอน import — ก่อนหน้านี้แต่ละไฟล์มี helper แปลงตัวเลขของตัวเอง
// (numberEnv / integerEnv / intervalEnv) ที่ clamp ไม่เหมือนกัน และ LINE config เดิม
// ถูกเช็คซ้ำ 3 ที่ ทำให้ค่า default จริงกับที่เขียนใน AGENTS.md เพี้ยนกันได้ง่าย

/** อ่านค่าตัวเลขจาก env แล้ว clamp ให้อยู่ในช่วง — ค่าที่ parse ไม่ได้จะใช้ fallback */
function numberEnv(name: string, fallback: number, min: number, max: number) {
  const raw = process.env[name]
  if (raw === undefined || raw.trim() === '') return fallback
  const value = Number(raw)
  return Number.isFinite(value) ? Math.min(Math.max(value, min), max) : fallback
}

const trimmedEnv = (name: string) => process.env[name]?.trim() ?? ''

export const config = {
  line: {
    url: trimmedEnv('LINE_NOTICE_URL'),
    apiKey: trimmedEnv('LINE_NOTICE_API_KEY'),
  },
  poll: {
    socketMs: numberEnv('SOCKET_POLL_MS', 60_000, 10_000, 3_600_000),
    energyAlertMs: numberEnv('ENERGY_ALERT_POLL_MS', 5 * 60_000, 60_000, 3_600_000),
    utilityAlertMs: numberEnv('UTILITY_ALERT_POLL_MS', 60 * 60_000, 5 * 60_000, 24 * 3_600_000),
  },
  energyAlert: {
    batteryReservePct: numberEnv('ENERGY_ALERT_BATTERY_RESERVE_PCT', 15, 0, 100),
    batteryEveningMaxPct: numberEnv('ENERGY_ALERT_BATTERY_EVENING_MAX_PCT', 95, 0, 100),
    minSolarRatio: numberEnv('ENERGY_ALERT_SOLAR_MIN_RATIO', 0.2, 0, 1),
    /** ว่าง = ใช้ ก.ค. ล่าสุดเป็นฐาน (ดู getDefaultSolarBaselineMonth) */
    baselineMonth: trimmedEnv('ENERGY_ALERT_SOLAR_BASELINE_MONTH'),
  },
  solar: {
    deviceId: trimmedEnv('SOLAR_DEVICE_ID'),
  },
  /** base URL ของเว็บ — ต้องเป็น absolute https เพราะ LINE fetch รูป QR จากภายนอก */
  appBaseUrl: trimmedEnv('APP_BASE_URL') || 'http://localhost:4321',
  /**
   * Biller ID สำหรับ QR จ่ายบิลข้ามธนาคาร
   *
   * ⚠️ **ไม่มี default โดยเจตนา** → ไม่ตั้ง = ซ่อน QR (fail-safe)
   *
   * ก่อนหน้านี้เคยใส่ default ที่อ่านด้วยตาจากตัวเลขใต้บาร์โค้ด ซึ่ง **ผิด**
   * — ตอนถอด QR บนบิลด้วยโปรแกรมพบว่าเป็นเลขอีกชุด และรูปแบบ Ref ก็ไม่ตรง
   * (ดู docs/bill-qr.md) QR จ่ายเงินที่ผิดอันตรายกว่าไม่มี QR เลย
   *
   * ค่าที่ต้องใส่: อ่านจาก QR บนบิล (ไม่ใช่ตัวเลขใต้บาร์โค้ด)
   */
  biller: {
    mea: trimmedEnv('MEA_BILLER_ID'),
    mwa: trimmedEnv('MWA_BILLER_ID'),
  },
  /** secret สำหรับ sign URL รูป QR (LINE ต้อง fetch ได้จากภายนอก) */
  qrSignSecret: trimmedEnv('QR_SIGN_SECRET') || trimmedEnv('BETTER_AUTH_SECRET'),
  /** อีเมลที่อนุญาต — lowercase ไว้แล้ว, ว่าง = ไม่กรอง */
  allowedEmails: new Set(
    trimmedEnv('ALLOWED_EMAILS')
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  ),
} as const

export const isLineNoticeConfigured = () => Boolean(config.line.url && config.line.apiKey)

/** true = ไม่ได้ตั้ง allowlist (เข้าได้ทุกอีเมลที่ login ผ่าน) */
export const isEmailAllowed = (email: string | null | undefined) => config.allowedEmails.size === 0 || config.allowedEmails.has((email ?? '').trim().toLowerCase())
