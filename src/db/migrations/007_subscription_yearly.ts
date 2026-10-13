import { sql, type Kysely } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('subscription')
    .addColumn('billing_interval', 'varchar(12)', (c) => c.notNull().defaultTo('monthly'))
    .addColumn('billing_date', 'date')
    .execute()
  await sql`ALTER TABLE subscription ADD CONSTRAINT subscription_interval_check CHECK (
    billing_interval IN ('monthly', 'yearly') AND (billing_interval <> 'yearly' OR billing_date IS NOT NULL)
  )`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('subscription').dropConstraint('subscription_interval_check').execute()
  await db.schema.alterTable('subscription').dropColumn('billing_interval').dropColumn('billing_date').execute()
}
