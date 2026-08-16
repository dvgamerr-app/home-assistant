import { sendLineMessages } from './line-transport'

const TONE_COLORS = {
  danger: '#A64B45',
  warning: '#B07A3C',
  success: '#5E7D68',
  info: '#6C7480',
} as const

const DEFAULT_AVATAR_URL = 'https://home.ourkk.com/lib.png'

export type EnergyNoticeTone = keyof typeof TONE_COLORS

export type EnergyNotice = {
  title: string
  tone: EnergyNoticeTone
  fields?: Array<{ label: string; value: string }>
  avatarUrl?: string
}

const truncate = (value: string, max: number) => (value.length > max ? `${value.slice(0, Math.max(0, max - 1))}…` : value)

const formatSentAt = (sentAt: Date) =>
  new Intl.DateTimeFormat('th-TH', {
    timeZone: 'Asia/Bangkok',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(sentAt)

const getEnergySender = (avatarUrl?: string) => ({
  name: 'Energy Lib',
  iconUrl: avatarUrl?.trim() || process.env.ENERGY_LIB_AVATAR_URL?.trim() || DEFAULT_AVATAR_URL,
})

export function buildEnergyFlexMessage(notice: EnergyNotice, sentAt = new Date()) {
  const accent = TONE_COLORS[notice.tone]
  const timeLabel = formatSentAt(sentAt)
  const fields = (notice.fields ?? []).slice(0, 6)

  return {
    type: 'flex',
    altText: truncate(notice.title, 400),
    sender: getEnergySender(notice.avatarUrl),
    contents: {
      type: 'bubble',
      size: 'giga',
      header: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '18px',
        paddingBottom: '12px',
        backgroundColor: '#F7F3EA',
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
        backgroundColor: '#FFFEFB',
        contents: fields.map((field, index) => ({
          type: 'box',
          layout: 'horizontal',
          ...(index > 0 ? { margin: 'sm' } : {}),
          contents: [
            {
              type: 'text',
              text: truncate(field.label, 40),
              size: 'xs',
              color: '#8C8379',
              flex: 4,
              wrap: true,
            },
            {
              type: 'text',
              text: truncate(field.value, 80),
              size: 'xs',
              color: '#2F2B27',
              weight: 'bold',
              align: 'end',
              flex: 6,
              wrap: true,
            },
          ],
        })),
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '18px',
        paddingTop: '10px',
        backgroundColor: '#FFFEFB',
        contents: [
          {
            type: 'separator',
            color: '#E8E0D4',
          },
          {
            type: 'text',
            text: `อัปเดต ${timeLabel}`,
            margin: 'md',
            size: 'xxs',
            color: '#9A9187',
            align: 'end',
          },
        ],
      },
      styles: {
        header: { separator: false },
        body: { separator: false },
        footer: { separator: false },
      },
    },
  }
}

export function buildEnergyNoticeRequest(notice: EnergyNotice, sentAt = new Date()) {
  return { messages: [buildEnergyFlexMessage(notice, sentAt)] }
}

export async function sendEnergyNotice(notice: EnergyNotice) {
  await sendLineMessages([buildEnergyFlexMessage(notice)])
}
