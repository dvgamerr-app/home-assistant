import { detailRow, FLEX_COLORS, NO_SEPARATOR_STYLES, sentAtText, truncate } from './line-flex'
import { sendLineMessages } from './line-transport'

const UTILITY_THEMES = {
  electricity: {
    displayName: 'ค่าไฟ',
    title: 'ค่าไฟฟ้า',
    avatarUrl: 'https://home.ourkk.com/mea.png',
    usageLabel: 'พลังงานที่ใช้',
  },
  water: {
    displayName: 'ค่าน้ำ',
    title: 'ค่าน้ำประปา',
    avatarUrl: 'https://home.ourkk.com/mwa.png',
    usageLabel: 'ปริมาณน้ำที่ใช้',
  },
} as const

export type UtilityBillNotice = {
  utility: keyof typeof UTILITY_THEMES
  period: string
  amount: string
  usage: string
  billDate?: string
  dueDate?: string
  /** URL รูป QR จ่ายบิล — ไม่ใส่ = ไม่แสดงส่วน QR */
  qrImageUrl?: string
}

export function buildUtilityBillFlexMessage(notice: UtilityBillNotice, sentAt = new Date()) {
  const theme = UTILITY_THEMES[notice.utility]
  const details = [
    { label: 'รอบบิล', value: notice.period },
    { label: theme.usageLabel, value: notice.usage },
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
        backgroundColor: FLEX_COLORS.card,
        contents: [
          {
            type: 'text',
            text: 'ยอดชำระ',
            size: 'xs',
            color: FLEX_COLORS.muted,
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
                color: FLEX_COLORS.foreground,
                flex: 0,
              },
              {
                type: 'text',
                text: 'บาท',
                margin: 'sm',
                size: 'sm',
                color: FLEX_COLORS.subtle,
                flex: 0,
              },
            ],
          },
          {
            type: 'separator',
            margin: 'xl',
            color: FLEX_COLORS.rule,
          },
          ...details.map((detail, index) => detailRow(detail.label, detail.value, { margin: index === 0 ? 'lg' : 'md', valueSize: 'sm' })),
          // QR จ่ายบิลข้ามธนาคาร — สแกนจากแอปธนาคารไทยได้เลย
          ...(notice.qrImageUrl
            ? [
                {
                  type: 'separator',
                  margin: 'xl',
                  color: FLEX_COLORS.rule,
                },
                {
                  type: 'text',
                  text: 'สแกนจ่ายผ่านแอปธนาคาร',
                  margin: 'lg',
                  size: 'xs',
                  color: FLEX_COLORS.muted,
                  align: 'center',
                },
                {
                  type: 'image',
                  url: notice.qrImageUrl,
                  margin: 'md',
                  size: 'full',
                  aspectRatio: '1:1',
                  aspectMode: 'fit',
                },
              ]
            : []),
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '20px',
        paddingTop: '10px',
        backgroundColor: FLEX_COLORS.card,
        contents: [sentAtText(sentAt)],
      },
      styles: NO_SEPARATOR_STYLES,
    },
  }
}

export async function sendUtilityBillNotice(notice: UtilityBillNotice) {
  await sendLineMessages([buildUtilityBillFlexMessage(notice)])
}
