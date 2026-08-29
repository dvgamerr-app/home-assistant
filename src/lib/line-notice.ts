import { detailRow, FLEX_COLORS, NO_SEPARATOR_STYLES, sentAtText, truncate } from './line-flex'
import { sendLineMessages } from './line-transport'

const TONE_COLORS = {
  danger: '#A64B45',
  warning: '#B07A3C',
  success: '#5E7D68',
  info: '#6C7480',
} as const

const DEFAULT_AVATAR_URL = 'https://home.ourkk.com/lib.png'
const MAX_FIELDS = 6

export type EnergyNoticeTone = keyof typeof TONE_COLORS

export type EnergyNotice = {
  title: string
  tone: EnergyNoticeTone
  fields?: Array<{ label: string; value: string }>
}

const energySender = () => ({
  name: 'EnergyLib',
  iconUrl: process.env.ENERGY_LIB_AVATAR_URL?.trim() || DEFAULT_AVATAR_URL,
})

export function buildEnergyFlexMessage(notice: EnergyNotice, sentAt = new Date()) {
  const accent = TONE_COLORS[notice.tone]
  const fields = (notice.fields ?? []).slice(0, MAX_FIELDS)

  return {
    type: 'flex',
    altText: truncate(notice.title, 400),
    sender: energySender(),
    contents: {
      type: 'bubble',
      size: 'giga',
      header: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '18px',
        paddingBottom: '12px',
        backgroundColor: FLEX_COLORS.cardHeader,
        contents: [
          {
            type: 'text',
            text: truncate(notice.title, 120),
            size: 'xl',
            weight: 'bold',
            color: accent,
            wrap: true,
          },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '18px',
        paddingTop: '14px',
        backgroundColor: FLEX_COLORS.card,
        contents: fields.map((field, index) => detailRow(field.label, field.value, index > 0 ? { margin: 'sm' } : {})),
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '18px',
        paddingTop: '10px',
        backgroundColor: FLEX_COLORS.card,
        contents: [
          {
            type: 'separator',
            color: FLEX_COLORS.rule,
          },
          { ...sentAtText(sentAt), margin: 'md' },
        ],
      },
      styles: NO_SEPARATOR_STYLES,
    },
  }
}

export async function sendEnergyNotice(notice: EnergyNotice) {
  await sendLineMessages([buildEnergyFlexMessage(notice)])
}

/**
 * ข้อความสั้นแบบ text ธรรมดา (ไม่ใช่ Flex card)
 * ใช้กับ alert ที่อ่านจบในบรรทัดเดียว เช่น อุปกรณ์ออนไลน์/ออฟไลน์
 */
export function buildEnergyTextMessage(text: string) {
  return {
    type: 'text',
    text: truncate(text, 4900),
    sender: energySender(),
  }
}

export async function sendEnergyTextNotice(text: string) {
  await sendLineMessages([buildEnergyTextMessage(text)])
}
