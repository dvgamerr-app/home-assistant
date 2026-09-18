import { bangkokDayStart, bangkokISODateAt } from './chart-viewport'

/**
 * บันทึกช่วงที่ "อุปกรณ์เครื่องนี้คุยกับเซิร์ฟเวอร์ไม่ได้" ของวันนี้
 *
 * หน้า /network อ่านยอดเน็ตหลุดจาก collector ซึ่งดึงมาตอน render — ถ้าเน็ตล่มจริง
 * ตัวเลขนั้นจะค้างอยู่ที่ค่าก่อนล่มตลอด เพราะ server ส่งค่าใหม่มาไม่ได้ ยอดที่ฝั่ง
 * เบราว์เซอร์จับเองจึงเป็นแหล่งเดียวที่รู้ว่า "ตอนนี้ก็ยังหลุดอยู่"
 *
 * ทุกฟังก์ชันเป็น pure + รับเวลาเข้ามา เพื่อให้เทสต์ได้โดยไม่ต้องมี localStorage
 */
export type OutageLog = {
  /** วัน (เวลาไทย) ที่ downSec นับอยู่ */
  date: string
  /** วินาทีของช่วงที่จบไปแล้วในวันนี้ */
  downSec: number
  /** เวลาที่เริ่มหลุดรอบปัจจุบัน — null = ตอนนี้ต่อได้ */
  openedAt: number | null
}

export const OUTAGE_LOG_KEY = 'ourkk:outage-log'

const toSec = (ms: number) => Math.max(0, Math.round(ms / 1000))

export function emptyOutageLog(at: number): OutageLog {
  return { date: bangkokISODateAt(at), downSec: 0, openedAt: null }
}

/** ข้ามวันแล้วตัดยอดใหม่ — ถ้ายังหลุดค้างอยู่ให้เริ่มนับต่อจากเที่ยงคืนของวันใหม่ */
export function rollOutageLog(log: OutageLog, at: number): OutageLog {
  const date = bangkokISODateAt(at)
  if (date === log.date) return log
  return { date, downSec: 0, openedAt: log.openedAt === null ? null : bangkokDayStart(date) }
}

/** เริ่มจับเวลาช่วงหลุด — เรียกซ้ำระหว่างที่ยังหลุดอยู่ไม่ทำให้เวลาเริ่มขยับ */
export function markOutageStart(log: OutageLog, at: number): OutageLog {
  const rolled = rollOutageLog(log, at)
  return rolled.openedAt === null ? { ...rolled, openedAt: at } : rolled
}

/** ปิดช่วงหลุดแล้วบวกเข้ายอดของวัน — เรียกตอนออนไลน์อยู่แล้วจะไม่เปลี่ยนอะไร */
export function markOutageEnd(log: OutageLog, at: number): OutageLog {
  const rolled = rollOutageLog(log, at)
  if (rolled.openedAt === null) return rolled
  return { ...rolled, downSec: rolled.downSec + toSec(at - rolled.openedAt), openedAt: null }
}

/** ช่วงที่กำลังหลุดอยู่ ณ ตอนนี้ (วินาที) — 0 = ต่อได้ */
export function currentOutageSec(log: OutageLog, at: number): number {
  const rolled = rollOutageLog(log, at)
  return rolled.openedAt === null ? 0 : toSec(at - rolled.openedAt)
}

/** ยอดรวมของวันนี้ นับรวมช่วงที่ยังหลุดค้างอยู่ด้วย */
export function outageSecToday(log: OutageLog, at: number): number {
  const rolled = rollOutageLog(log, at)
  return rolled.downSec + currentOutageSec(rolled, at)
}

export function serializeOutageLog(log: OutageLog): string {
  return JSON.stringify(log)
}

/** ค่าที่อ่านจาก localStorage เชื่อไม่ได้ — พังเมื่อไหร่เริ่มนับใหม่แทนที่จะโยน error */
export function parseOutageLog(raw: string | null, at: number): OutageLog {
  if (!raw) return emptyOutageLog(at)
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return emptyOutageLog(at)
    const { date, downSec, openedAt } = parsed as Record<string, unknown>
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return emptyOutageLog(at)
    if (typeof downSec !== 'number' || !Number.isFinite(downSec) || downSec < 0) return emptyOutageLog(at)
    if (openedAt !== null && (typeof openedAt !== 'number' || !Number.isFinite(openedAt))) return emptyOutageLog(at)
    return rollOutageLog({ date, downSec, openedAt }, at)
  } catch {
    return emptyOutageLog(at)
  }
}

/** "8 นาที" / "1.4 ชม." — ใช้ร่วมกันทั้งการ์ดสถานะและแถบแจ้งเตือน */
export function formatOutageDuration(seconds: number): string {
  if (seconds < 60) return `${Math.max(0, Math.round(seconds))} วินาที`
  if (seconds < 3600) return `${Math.round(seconds / 60)} นาที`
  return `${(seconds / 3600).toFixed(1)} ชม.`
}
