import { Kysely, PostgresDialect, CamelCasePlugin } from 'kysely'
import pg from 'pg'

export type AuthDatabase = Kysely<Record<string, Record<string, unknown>>>

let _db: AuthDatabase | null = null

export function getAuthDb(): AuthDatabase {
  if (!_db) {
    const pool = new pg.Pool({ connectionString: process.env.AUTH_DATABASE_URL! })
    _db = new Kysely<Record<string, Record<string, unknown>>>({
      dialect: new PostgresDialect({ pool }),
      plugins: [new CamelCasePlugin()],
    })
  }
  return _db
}
