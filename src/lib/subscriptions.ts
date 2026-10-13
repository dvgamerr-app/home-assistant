import { getBangkokISODate } from './date'

export const CURRENCIES = ['THB', 'USD'] as const
export type Currency = (typeof CURRENCIES)[number]
export const STATUS_LABELS = { active: 'ใช้งานอยู่', paused: 'พักบริการ', cancelled: 'ยกเลิกแล้ว' } as const
export type SubscriptionStatus = keyof typeof STATUS_LABELS

export interface SubscriptionAccount {
  id: string
  name: string
  identifier: string
  version: number
}

export interface Subscription {
  id: string
  accountId: string
  service: string
  plan: string
  amountMinor: number
  currency: Currency
  billingDay: number
  billingInterval: 'monthly' | 'yearly'
  billingDate: string | null
  status: SubscriptionStatus
  url: string
  notes: string
  version: number
  updatedAt: string
  createdByName: string | null
  updatedByName: string | null
}

/** ค่าสาธารณูปโภคที่ดึงจากบิลจริง ใช้เฉลี่ยหลายเดือนเพื่อไม่ให้ยอดเดือนเดียวทำให้สัดส่วนเพี้ยน */
export interface UtilityExpense {
  key: 'electricity' | 'water'
  label: string
  href: string
  /** ยอดเฉลี่ยต่อเดือน หน่วยสตางค์ */
  amountMinor: number
  months: number
}

export interface SubscriptionSnapshot {
  accounts: SubscriptionAccount[]
  subscriptions: Subscription[]
  exchangeRate: SubscriptionExchangeRate | null
  utilities: UtilityExpense[]
}

export interface SubscriptionExchangeRate {
  /** THB per USD, decimal string to preserve exact conversion before rounding. */
  usdThb: string
  updatedAt: string
  source: string
}

export class SubscriptionError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message)
  }
}

export function textField(value: unknown, label: string, max: number, required = false) {
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) {
    throw new SubscriptionError(`กรุณาระบุ${label}${required ? '' : 'ให้ถูกต้อง'} (ไม่เกิน ${max} ตัวอักษร)`)
  }
  return value.trim()
}

export function parseId(value: unknown) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new SubscriptionError('รหัสรายการไม่ถูกต้อง')
  }
  return value
}

export function parseVersion(value: unknown) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new SubscriptionError('เวอร์ชันข้อมูลไม่ถูกต้อง กรุณาโหลดใหม่')
  return value
}

export function parseAccount(input: Record<string, unknown>) {
  return {
    name: textField(input.name, 'ชื่อบัญชี', 100, true),
    identifier: textField(input.identifier, 'อีเมลหรือชื่อผู้ใช้', 254),
  }
}

export function parseSubscription(input: Record<string, unknown>) {
  const amount = input.amount
  if (typeof amount !== 'string' || !/^\d{1,7}(\.\d{1,2})?$/.test(amount) || Number(amount) > 1000000) {
    throw new SubscriptionError('ค่าบริการต้องอยู่ระหว่าง 0–1,000,000 และมีทศนิยมไม่เกิน 2 ตำแหน่ง')
  }
  const currency = CURRENCIES.find((item) => item === input.currency)
  if (!currency) throw new SubscriptionError('กรุณาเลือกสกุลเงินที่รองรับ')
  const billingDay = input.billingDay
  if (typeof billingDay !== 'number' || !Number.isInteger(billingDay) || billingDay < 1 || billingDay > 31) throw new SubscriptionError('วันเรียกเก็บต้องอยู่ระหว่าง 1–31')
  const status = input.status
  const billingInterval = input.billingInterval ?? 'monthly'
  if (billingInterval !== 'monthly' && billingInterval !== 'yearly') throw new SubscriptionError('รอบเรียกเก็บไม่ถูกต้อง')
  const billingDate = billingInterval === 'yearly' ? input.billingDate : null
  if (
    billingInterval === 'yearly' &&
    (typeof billingDate !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(billingDate) ||
      !Number.isFinite(Date.parse(`${billingDate}T00:00:00Z`)) ||
      new Date(`${billingDate}T00:00:00Z`).toISOString().slice(0, 10) !== billingDate)
  ) {
    throw new SubscriptionError('กรุณาระบุวันที่อ้างอิงรอบรายปีให้ถูกต้อง')
  }
  if (status !== 'active' && status !== 'paused' && status !== 'cancelled') throw new SubscriptionError('สถานะไม่ถูกต้อง')
  let url = textField(input.url, 'ลิงก์บริการ', 2048)
  if (url) {
    try {
      if (!/^[a-z][a-z\d+.-]*:/i.test(url)) url = `https://${url}`
      const parsed = new URL(url)
      if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password || url.length > 2048) throw new Error()
    } catch {
      throw new SubscriptionError('ลิงก์บริการต้องเป็น http หรือ https และไม่มีรหัสผ่านในลิงก์')
    }
  }
  const [whole, fraction = ''] = amount.split('.')
  return {
    accountId: parseId(input.accountId),
    service: textField(input.service, 'ชื่อบริการ', 100, true),
    plan: textField(input.plan, 'ชื่อแพ็กเกจ', 100),
    amountMinor: Number(whole) * 100 + Number(fraction.padEnd(2, '0')),
    currency,
    billingDay,
    billingInterval,
    billingDate,
    status,
    url,
    notes: textField(input.notes, 'หมายเหตุ', 1000),
  }
}

/** วันที่ 29–31 ใช้วันสุดท้ายหากเดือนนั้นสั้นกว่า โดยยังคงวันเรียกเก็บต้นฉบับไว้ */
export function nextBillingDate(billingDay: number, today = getBangkokISODate()) {
  const [year, month] = today.split('-').map(Number)
  const occurrence = (offset: number) => {
    const first = new Date(Date.UTC(year, month - 1 + offset, 1))
    const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
    first.setUTCDate(Math.min(billingDay, lastDay))
    return first.toISOString().slice(0, 10)
  }
  const current = occurrence(0)
  return current >= today ? current : occurrence(1)
}

export function daysUntil(date: string, today = getBangkokISODate()) {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000)
}

export function subscriptionBillingDate(item: Subscription, today = getBangkokISODate()) {
  if (item.billingInterval !== 'yearly' || !item.billingDate) return nextBillingDate(item.billingDay, today)
  const [anchorYear, month, day] = item.billingDate.split('-').map(Number)
  let year = Math.max(anchorYear, Number(today.slice(0, 4)))
  const occurrence = () => {
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
    return `${year}-${String(month).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`
  }
  if (occurrence() < today) year++
  return occurrence()
}

export function monthlyBahtMinor(item: Subscription, rate: SubscriptionExchangeRate | null) {
  const converted = toBahtMinor(item.amountMinor, item.currency, rate)
  return converted === null ? null : item.billingInterval === 'yearly' ? Math.round(converted / 12) : converted
}

export function toBahtMinor(amountMinor: number, currency: Currency, rate: SubscriptionExchangeRate | null): number | null {
  if (currency === 'THB') return amountMinor
  if (currency !== 'USD' || !rate || !/^\d{1,4}(\.\d{1,8})?$/.test(rate.usdThb) || Number(rate.usdThb) <= 0) return null
  const [whole, fraction = ''] = rate.usdThb.split('.')
  const scale = 10n ** BigInt(fraction.length)
  const numerator = BigInt(whole + fraction)
  // Round each converted charge to satang, then add those displayed charges.
  return Number((BigInt(amountMinor) * numerator + scale / 2n) / scale)
}

export function monthlyBahtTotal(subscriptions: Subscription[], rate: SubscriptionExchangeRate | null, yearly = false) {
  let amountMinor = 0
  let unconvertedCount = 0
  for (const item of subscriptions) {
    if (item.status !== 'active') continue
    const charge = toBahtMinor(item.amountMinor, item.currency, rate)
    const converted = yearly ? (charge === null ? null : charge * (item.billingInterval === 'yearly' ? 1 : 12)) : monthlyBahtMinor(item, rate)
    if (converted === null) unconvertedCount++
    else amountMinor += converted
  }
  return { amountMinor: unconvertedCount ? null : amountMinor, unconvertedCount }
}

export function money(amountMinor: number, currency: Currency) {
  return new Intl.NumberFormat('th-TH', { style: 'currency', currency, currencyDisplay: 'narrowSymbol', minimumFractionDigits: 2 }).format(amountMinor / 100)
}
