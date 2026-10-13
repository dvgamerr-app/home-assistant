import { sql, type Kysely } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('subscription_account')
    .addColumn('id', 'uuid', (c) => c.primaryKey())
    .addColumn('name', 'varchar(100)', (c) => c.notNull())
    .addColumn('identifier', 'varchar(254)', (c) => c.notNull().defaultTo(''))
    .addColumn('created_by', 'text', (c) => c.references('user.id').onDelete('set null'))
    .addColumn('updated_by', 'text', (c) => c.references('user.id').onDelete('set null'))
    .addColumn('version', 'integer', (c) => c.notNull().defaultTo(1))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('subscription_account_name_check', sql`length(trim(name)) > 0`)
    .execute()
  await sql`CREATE UNIQUE INDEX subscription_account_identity_key ON subscription_account (lower(name), lower(identifier))`.execute(db)

  await db.schema
    .createTable('subscription')
    .addColumn('id', 'uuid', (c) => c.primaryKey())
    .addColumn('account_id', 'uuid', (c) => c.notNull().references('subscription_account.id').onDelete('restrict'))
    .addColumn('service', 'varchar(100)', (c) => c.notNull())
    .addColumn('plan', 'varchar(100)', (c) => c.notNull().defaultTo(''))
    .addColumn('amount_minor', 'integer', (c) => c.notNull())
    .addColumn('currency', 'varchar(3)', (c) => c.notNull().defaultTo('THB'))
    .addColumn('billing_day', 'integer', (c) => c.notNull())
    .addColumn('status', 'varchar(12)', (c) => c.notNull().defaultTo('active'))
    .addColumn('url', 'varchar(2048)', (c) => c.notNull().defaultTo(''))
    .addColumn('notes', 'varchar(1000)', (c) => c.notNull().defaultTo(''))
    .addColumn('created_by', 'text', (c) => c.references('user.id').onDelete('set null'))
    .addColumn('updated_by', 'text', (c) => c.references('user.id').onDelete('set null'))
    .addColumn('version', 'integer', (c) => c.notNull().defaultTo(1))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('subscription_service_check', sql`length(trim(service)) > 0`)
    .addCheckConstraint('subscription_amount_check', sql`amount_minor >= 0 AND amount_minor <= 100000000`)
    .addCheckConstraint('subscription_currency_check', sql`currency IN ('THB', 'USD', 'EUR', 'GBP', 'SGD')`)
    .addCheckConstraint('subscription_day_check', sql`billing_day BETWEEN 1 AND 31`)
    .addCheckConstraint('subscription_status_check', sql`status IN ('active', 'paused', 'cancelled')`)
    .execute()
  await db.schema.createIndex('subscription_account_idx').on('subscription').column('account_id').execute()
  await sql`CREATE UNIQUE INDEX subscription_service_plan_key ON subscription (account_id, lower(service), lower(plan))`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('subscription').execute()
  await db.schema.dropTable('subscription_account').execute()
}
