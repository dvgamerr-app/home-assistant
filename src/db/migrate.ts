import { Migrator } from 'kysely/migration'
import { logger } from '../lib/logger'
import { getAuthDb } from './auth-db'
import { migrations } from './migrations'

/** รัน migration ที่ค้างอยู่ให้ครบ — throw ถ้าพัง (Kysely ล็อกใน DB เองจึงเรียกซ้อนจากหลาย process ได้) */
export async function runMigrations(): Promise<void> {
  const migrator = new Migrator({ db: getAuthDb(), provider: { getMigrations: async () => migrations } })
  const { error, results } = await migrator.migrateToLatest()

  for (const r of results ?? []) {
    if (r.status === 'Success') logger.info(`migration "${r.migrationName}" applied`)
    else if (r.status === 'Error') logger.error(`migration "${r.migrationName}" FAILED`)
  }
  if (error) throw error
}
