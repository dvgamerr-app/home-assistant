// primitive ที่ใช้ร่วมกันของ LINE Flex card ทุกใบ
// เดิม line-notice.ts กับ utility-line-notice.ts เขียน truncate / formatSentAt /
// สี hex / โครง bubble แยกกันคนละชุด ทำให้การ์ดสองใบค่อยๆ ห่างกันเรื่อยๆ

import { formatBangkokDateTime } from './date'

/** สีของการ์ด — โทนเดียวกับ design token ของเว็บ */
export const FLEX_COLORS = {
  /** ตัวเลข/ค่าเน้น */
  foreground: '#2F2B27',
  /** label */
  muted: '#8C8379',
  /** ข้อความรอง */
  subtle: '#5E5851',
  /** timestamp ท้ายการ์ด */
  faint: '#9A9187',
  /** เส้นคั่น */
  rule: '#E8E0D4',
  /** พื้นการ์ด */
  card: '#FFFEFB',
  /** พื้นหัวการ์ด */
  cardHeader: '#F7F3EA',
} as const

/** LINE ตัดข้อความยาวเองไม่สวย — ตัดเองพร้อมใส่ … */
export const truncate = (value: string, max: number) => (value.length > max ? `${value.slice(0, Math.max(0, max - 1))}…` : value)

/** ปิด separator อัตโนมัติของ LINE ทุกส่วน (การ์ดวาดเส้นเองตามดีไซน์) */
export const NO_SEPARATOR_STYLES = {
  header: { separator: false },
  body: { separator: false },
  footer: { separator: false },
} as const

export type DetailRowOptions = {
  /** margin ด้านบนของแถว */
  margin?: string
  /** ขนาดตัวอักษรฝั่งค่า */
  valueSize?: string
}

/** แถว "label ...... value" ที่ทั้งสองการ์ดใช้เหมือนกัน */
export function detailRow(label: string, value: string, { margin, valueSize = 'xs' }: DetailRowOptions = {}) {
  return {
    type: 'box',
    layout: 'horizontal',
    ...(margin ? { margin } : {}),
    contents: [
      {
        type: 'text',
        text: truncate(label, 40),
        size: 'xs',
        color: FLEX_COLORS.muted,
        flex: 4,
        wrap: true,
      },
      {
        type: 'text',
        text: truncate(value, 80),
        size: valueSize,
        color: FLEX_COLORS.foreground,
        weight: 'bold',
        align: 'end',
        flex: 6,
        wrap: true,
      },
    ],
  }
}

/** ข้อความ "อัปเดต <เวลา>" ท้ายการ์ด */
export function sentAtText(sentAt: Date) {
  return {
    type: 'text',
    text: `อัปเดต ${formatBangkokDateTime(sentAt)}`,
    size: 'xxs',
    color: FLEX_COLORS.faint,
    align: 'end',
  }
}
