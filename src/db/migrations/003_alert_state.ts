import { sql, type Kysely } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('alert_state')
    .addColumn('alert_key', 'text', (column) => column.primaryKey())
    .addColumn('status', 'text', (column) => column.notNull())
    .addColumn('last_value', 'text')
    .addColumn('last_notified_at', 'timestamptz')
    .addColumn('updated_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('alert_state').ifExists().execute()
}
