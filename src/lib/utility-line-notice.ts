import { sendLineMessages } from './line-transport'

const UTILITY_THEMES = {
  electricity: {
    displayName: 'ค่าไฟ',
    title: 'ค่าไฟฟ้า',
    avatarUrl: 'https://home.ourkk.com/mea.png',
  },
  water: {
    displayName: 'ค่าน้ำ',
    title: 'ค่าน้ำประปา',
    avatarUrl: 'https://home.ourkk.com/mwa.png',
  },
} as const

export type UtilityBillNotice = {
  utility: keyof typeof UTILITY_THEMES
  period: string
  amount: string
  usage: string
  billDate?: string
  dueDate?: string
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

export function buildUtilityBillFlexMessage(notice: UtilityBillNotice, sentAt = new Date()) {
  const theme = UTILITY_THEMES[notice.utility]
  const details = [
    { label: 'รอบบิล', value: notice.period },
    { label: notice.utility === 'electricity' ? 'พลังงานที่ใช้' : 'ปริมาณน้ำที่ใช้', value: notice.usage },
    ...(notice.billDate ? [{ label: 'วันที่ออกบิล', value: notice.billDate }] : []),
    ...(notice.dueDate ? [{ label: 'กำหนดชำระ', value: notice.dueDate }] : []),
  ]

  return {
    type: 'flex',
    altText: truncate(`${theme.title} ${notice.period} · ${notice.amount} บาท`, 400),
    sender: {
      name: theme.displayName,
      iconUrl: theme.avatarUrl,
    },
    contents: {
      type: 'bubble',
      size: 'mega',
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '20px',
        backgroundColor: '#FFFEFB',
        contents: [
          {
            type: 'text',
            text: 'ยอดชำระ',
            size: 'xs',
            color: '#8C8379',
          },
          {
            type: 'box',
            layout: 'baseline',
            margin: 'sm',
            contents: [
              {
                type: 'text',
                text: notice.amount,
                size: '3xl',
                weight: 'bold',
                color: '#2F2B27',
                flex: 0,
              },
              {
                type: 'text',
                text: 'บาท',
                margin: 'sm',
                size: 'sm',
                color: '#5E5851',
                flex: 0,
              },
            ],
          },
          {
            type: 'separator',
            margin: 'xl',
            color: '#E8E0D4',
          },
          ...details.map((detail, index) => ({
            type: 'box',
            layout: 'horizontal',
            margin: index === 0 ? 'lg' : 'md',
            contents: [
              {
                type: 'text',
                text: detail.label,
                size: 'xs',
                color: '#8C8379',
                flex: 4,
              },
              {
                type: 'text',
                text: detail.value,
                size: 'sm',
                color: '#2F2B27',
                weight: 'bold',
                align: 'end',
                flex: 6,
                wrap: true,
              },
            ],
          })),
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '20px',
        paddingTop: '10px',
        backgroundColor: '#FFFEFB',
        contents: [
          {
            type: 'text',
            text: `อัปเดต ${formatSentAt(sentAt)}`,
            size: 'xxs',
            color: '#9A9187',
            align: 'end',
          },
        ],
      },
      styles: {
        body: { separator: false },
        footer: { separator: false },
      },
    },
  }
}

export function buildUtilityBillNoticeRequest(notice: UtilityBillNotice, sentAt = new Date()) {
  return { messages: [buildUtilityBillFlexMessage(notice, sentAt)] }
}

export async function sendUtilityBillNotice(notice: UtilityBillNotice) {
  await sendLineMessages([buildUtilityBillFlexMessage(notice)])
}
