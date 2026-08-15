import type { Kysely } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('user')
    .addColumn('two_factor_enabled', 'boolean', (column) => column.notNull().defaultTo(false))
    .execute()

  await db.schema
    .createTable('two_factor')
    .addColumn('id', 'text', (column) => column.primaryKey())
    .addColumn('secret', 'text', (column) => column.notNull())
    .addColumn('backup_codes', 'text', (column) => column.notNull())
    .addColumn('user_id', 'text', (column) => column.notNull().references('user.id').onDelete('cascade'))
    .addColumn('verified', 'boolean', (column) => column.notNull().defaultTo(true))
    .addColumn('failed_verification_count', 'integer', (column) => column.notNull().defaultTo(0))
    .addColumn('locked_until', 'timestamptz')
    .execute()

  await db.schema.createIndex('two_factor_secret_idx').on('two_factor').column('secret').execute()
  await db.schema.createIndex('two_factor_user_id_idx').on('two_factor').column('user_id').execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('two_factor').ifExists().execute()
  await db.schema.alterTable('user').dropColumn('two_factor_enabled').execute()
}
