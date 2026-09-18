import { sql, type Kysely } from 'kysely'

/**
 * Better Auth 1.7.3 ยกเลิกคอลัมน์ `account.issuer` ที่เพิ่งบังคับใน 1.7.0–1.7.2
 * (กลับไปใช้ `provider_id` + `account_id` ระบุบัญชีเหมือน 1.6) แปลว่า library ไม่เขียนคอลัมน์นี้อีกแล้ว
 * NOT NULL ที่ migration 004 ใส่ไว้จึงทำให้ sign-up / link บัญชี insert ไม่ผ่านทุกครั้ง
 *
 * ทำตามคู่มือ: ทิ้ง unique index ก่อน แล้วค่อยปลด NOT NULL
 * https://www.better-auth.com/docs/guides/1-7-upgrade-guide
 *
 * ยังไม่ drop คอลัมน์ทิ้งเพื่อไม่ให้ rollback แล้วข้อมูลเดิมหาย — ถ้าอยากล้างจริงค่อยเพิ่ม migration ถัดไป
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex('account_issuer_account_id_key').ifExists().execute()

  await db.schema
    .alterTable('account')
    .alterColumn('issuer', (column) => column.dropNotNull())
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // แถวที่ Better Auth 1.7.3+ สร้างหลังปลด NOT NULL จะไม่มี issuer ต้องเติมก่อนบังคับ NOT NULL กลับ
  const unsupportedProviders = await sql<{ provider_id: string }>`
    SELECT DISTINCT provider_id
    FROM "account"
    WHERE issuer IS NULL
      AND provider_id NOT IN ('credential', 'github')
  `.execute(db)

  if (unsupportedProviders.rows.length > 0) {
    const providers = unsupportedProviders.rows.map((row) => row.provider_id).join(', ')
    throw new Error(`Cannot backfill account issuer for unsupported providers: ${providers}`)
  }

  await sql`
    UPDATE "account"
    SET issuer = CASE provider_id
      WHEN 'credential' THEN 'local:credential'
      WHEN 'github' THEN 'local:oauth:github'
    END
    WHERE issuer IS NULL
  `.execute(db)

  await db.schema
    .alterTable('account')
    .alterColumn('issuer', (column) => column.setNotNull())
    .execute()

  await db.schema.createIndex('account_issuer_account_id_key').on('account').columns(['issuer', 'account_id']).unique().execute()
}
