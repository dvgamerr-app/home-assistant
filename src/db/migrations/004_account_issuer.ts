import type { Kysely } from 'kysely'
import { sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  const unsupportedProviders = await sql<{ provider_id: string }>`
    SELECT DISTINCT provider_id
    FROM "account"
    WHERE provider_id NOT IN ('credential', 'github')
  `.execute(db)

  if (unsupportedProviders.rows.length > 0) {
    const providers = unsupportedProviders.rows.map((row) => row.provider_id).join(', ')
    throw new Error(`Cannot backfill account issuer for unsupported providers: ${providers}`)
  }

  await db.schema.alterTable('account').addColumn('issuer', 'text').execute()

  await sql`
    UPDATE "account"
    SET issuer = CASE provider_id
      WHEN 'credential' THEN 'local:credential'
      WHEN 'github' THEN 'local:oauth:github'
    END
  `.execute(db)

  await db.schema
    .alterTable('account')
    .alterColumn('issuer', (column) => column.setNotNull())
    .execute()

  await db.schema.createIndex('account_issuer_account_id_key').on('account').columns(['issuer', 'account_id']).unique().execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex('account_issuer_account_id_key').ifExists().execute()
  await db.schema.alterTable('account').dropColumn('issuer').execute()
}
