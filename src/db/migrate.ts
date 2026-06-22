import { FileMigrationProvider, Migrator } from 'kysely/migration'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { getAuthDb } from './auth-db'

const db = getAuthDb()
const migrator = new Migrator({
  db,
  provider: new FileMigrationProvider({
    fs: { readdir },
    path: { join },
    migrationFolder: join(import.meta.dirname, 'migrations'),
  }),
})

const { error, results } = await migrator.migrateToLatest()
results?.forEach((r) => {
  if (r.status === 'Success') console.log(`migration "${r.migrationName}" applied`)
  else if (r.status === 'Error') console.error(`migration "${r.migrationName}" FAILED`)
})
if (error) {
  console.error('migration error:', error)
  process.exit(1)
}
console.log('migrations done')
await db.destroy()
