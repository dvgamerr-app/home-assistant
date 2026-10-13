import { sql } from 'kysely'
import { getAuthDb } from '../db/auth-db'
import { getBills, getWaterUsage } from './db'
import { logger } from './logger'
import { getSubscriptionRate } from './subscription-exchange-rate'
import { parseAccount, parseId, parseSubscription, parseVersion, SubscriptionError, type Subscription, type SubscriptionAccount, type SubscriptionSnapshot, type UtilityExpense } from './subscriptions'

const UTILITY_MONTHS = 3

const average = (label: UtilityExpense['label'], key: UtilityExpense['key'], href: string, baht: number[]): UtilityExpense[] => {
  const billed = baht.filter((value) => value > 0)
  if (!billed.length) return []
  return [{ key, label, href, amountMinor: Math.round((billed.reduce((sum, value) => sum + value, 0) / billed.length) * 100), months: billed.length }]
}

/** ค่าไฟ/ค่าน้ำเฉลี่ยจากบิลล่าสุด ถ้า collector DB ใช้ไม่ได้ให้ข้ามไป ไม่ให้หน้า Subscription พังทั้งหน้า */
async function getUtilityExpenses(): Promise<UtilityExpense[]> {
  const [bills, water] = await Promise.allSettled([getBills(UTILITY_MONTHS), getWaterUsage(UTILITY_MONTHS)])
  if (bills.status === 'rejected') logger.error({ err: bills.reason }, 'subscription: electricity bills unavailable')
  if (water.status === 'rejected') logger.error({ err: water.reason }, 'subscription: water bills unavailable')
  return [
    ...(bills.status === 'fulfilled'
      ? average(
          'ค่าไฟฟ้า',
          'electricity',
          '/electricity/bill',
          bills.value.map((bill) => bill.paid),
        )
      : []),
    ...(water.status === 'fulfilled'
      ? average(
          'ค่าน้ำประปา',
          'water',
          '/electricity/water',
          water.value.map((bill) => bill.billedAmount),
        )
      : []),
  ]
}

/** ชุดข้อมูลกลางของบ้าน ไม่กรอง created_by ตามผู้ที่เปิดหน้า */
export async function getSubscriptions(): Promise<SubscriptionSnapshot> {
  const db = getAuthDb()
  const [accounts, subscriptions, exchangeRate, utilities] = await Promise.all([
    sql<SubscriptionAccount>`SELECT id, name, identifier, version FROM subscription_account ORDER BY lower(name), identifier`.execute(db),
    sql<Omit<Subscription, 'updatedAt'> & { updatedAt: Date }>`
      SELECT s.id, s.account_id, s.service, s.plan, s.amount_minor, s.currency, s.billing_day,
        s.billing_interval, to_char(s.billing_date, 'YYYY-MM-DD') AS billing_date,
        s.status, s.url, s.notes, s.version, s.updated_at,
        creator.name AS created_by_name, editor.name AS updated_by_name
      FROM subscription s
      LEFT JOIN "user" creator ON creator.id = s.created_by
      LEFT JOIN "user" editor ON editor.id = s.updated_by
      ORDER BY lower(s.service), s.created_at
    `.execute(db),
    getSubscriptionRate(),
    getUtilityExpenses(),
  ])
  return {
    accounts: accounts.rows,
    exchangeRate,
    utilities,
    subscriptions: subscriptions.rows.map((row) => ({ ...row, updatedAt: new Date(row.updatedAt).toISOString() })),
  }
}

export async function saveSubscriptionData(kind: 'account' | 'subscription', input: Record<string, unknown>, userId: string, updating: boolean) {
  const db = getAuthDb()
  const id = updating ? parseId(input.id) : crypto.randomUUID()
  const version = updating ? parseVersion(input.version) : 1
  const table = kind === 'account' ? 'subscription_account' : 'subscription'
  const values = kind === 'account' ? parseAccount(input) : parseSubscription(input)
  try {
    if (updating) {
      const result = await db
        .updateTable(table)
        .set({ ...values, updatedBy: userId, updatedAt: new Date(), version: version + 1 })
        .where('id', '=', id)
        .where('version', '=', version)
        .returning('id')
        .executeTakeFirst()
      if (!result) throw new SubscriptionError('ข้อมูลนี้ถูกแก้ไขจากอีกเครื่องแล้ว กรุณาโหลดข้อมูลล่าสุดก่อนแก้ไขอีกครั้ง', 409)
    } else {
      await db
        .insertInto(table)
        .values({ ...values, id, createdBy: userId, updatedBy: userId })
        .execute()
    }
    return { id }
  } catch (error) {
    if (error instanceof SubscriptionError) throw error
    const code = (error as { code?: string }).code
    if (code === '23505') throw new SubscriptionError(kind === 'account' ? 'มีชื่อบัญชีและอีเมลนี้แล้ว' : 'มีบริการและแพ็กเกจนี้ในบัญชีแล้ว กรุณาแก้ไขรายการเดิม', 409)
    if (code === '23503') throw new SubscriptionError('ไม่พบบัญชีที่เลือก กรุณาโหลดข้อมูลใหม่', 409)
    throw error
  }
}
