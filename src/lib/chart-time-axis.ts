// ป้ายแกนเวลาและข้อความช่วงที่มองเห็น — ใช้ร่วมกันระหว่างกราฟที่ซูม/เลื่อนได้ทุกตัว
// (ก่อนหน้านี้อยู่ใน production-chart-client ไฟล์เดียว พอทำกราฟตัวที่สองจึงต้องยกออกมา)

import { BANGKOK_OFFSET_MS, DAY_MS, HOUR_MS, MINUTE_MS, bangkokISODateAt, type TimeRange } from './chart-viewport'

const dayFormat = new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: '2-digit' })
const shortDayFormat = new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short' })
const timeFormat = new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

const INTERVALS = [15 * MINUTE_MS, 30 * MINUTE_MS, HOUR_MS, 2 * HOUR_MS, 3 * HOUR_MS, 6 * HOUR_MS, 12 * HOUR_MS, DAY_MS]

/** ระยะห่างของ tick ที่อ่านง่ายที่สุดสำหรับความกว้างจริงของกราฟ */
export function tickInterval(span: number, width: number) {
  const targetCount = Math.max(3, Math.min(8, Math.floor(width / 76)))
  const target = span / targetCount
  return INTERVALS.find((interval) => interval >= target) ?? DAY_MS
}

/** tick ของแกนเวลาในรูปสัดส่วน 0..1 ของช่วงที่มองเห็น พร้อมป้ายที่จัดรูปแล้ว */
export function timeAxisTicks(range: TimeRange, plotWidth: number) {
  const span = Math.max(range.end - range.start, 1)
  const interval = tickInterval(span, plotWidth)
  const crossesDay = bangkokISODateAt(range.start) !== bangkokISODateAt(range.end - 1)
  const ticks: { ratio: number; label: string }[] = []

  let timestamp = Math.ceil((range.start + BANGKOK_OFFSET_MS) / interval) * interval - BANGKOK_OFFSET_MS
  while (timestamp < range.end) {
    const label = interval >= DAY_MS ? shortDayFormat.format(timestamp) : crossesDay ? `${shortDayFormat.format(timestamp)} · ${timeFormat.format(timestamp)}` : timeFormat.format(timestamp)
    ticks.push({ ratio: (timestamp - range.start) / span, label })
    timestamp += interval
  }

  return ticks
}

/** ข้อความบอกช่วงเวลาที่กำลังดูอยู่ใต้กราฟ */
export function formatVisibleRange(range: TimeRange) {
  const firstDate = bangkokISODateAt(range.start)
  const lastDate = bangkokISODateAt(range.end - 1)
  if (firstDate === lastDate) return `${dayFormat.format(range.start)} · ${timeFormat.format(range.start)}–${timeFormat.format(range.end - 1)} น.`
  return `${shortDayFormat.format(range.start)} ${timeFormat.format(range.start)} – ${shortDayFormat.format(range.end - 1)} ${timeFormat.format(range.end - 1)} น.`
}

/** เวลาบนหัว tooltip ของจุดที่ชี้อยู่ */
export function formatPointTime(timestamp: number) {
  return `${shortDayFormat.format(timestamp)} · ${timeFormat.format(timestamp)} น.`
}
