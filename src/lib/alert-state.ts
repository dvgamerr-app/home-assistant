import { getAuthDb } from '../db/auth-db'

export type AlertState = {
  alertKey: string
  status: string
  lastValue: string | null
  lastNotifiedAt: Date | null
  updatedAt: Date
}

export async function getAlertState(alertKey: string): Promise<AlertState | null> {
  const row = await getAuthDb().selectFrom('alertState').select(['alertKey', 'status', 'lastValue', 'lastNotifiedAt', 'updatedAt']).where('alertKey', '=', alertKey).executeTakeFirst()

  return (row as AlertState | undefined) ?? null
}

export async function setAlertState(input: { alertKey: string; status: string; lastValue?: string | null; notified?: boolean }) {
  const now = new Date()
  const values = {
    alertKey: input.alertKey,
    status: input.status,
    lastValue: input.lastValue ?? null,
    lastNotifiedAt: input.notified ? now : null,
    updatedAt: now,
  }

  await getAuthDb()
    .insertInto('alertState')
    .values(values)
    .onConflict((conflict) =>
      conflict.column('alertKey').doUpdateSet({
        status: input.status,
        lastValue: input.lastValue ?? null,
        ...(input.notified ? { lastNotifiedAt: now } : {}),
        updatedAt: now,
      }),
    )
    .execute()
}
