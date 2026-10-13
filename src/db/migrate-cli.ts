import { getAuthDb } from './auth-db'
import { runMigrations } from './migrate'

try {
  await runMigrations()
  console.log('migrations done')
} catch (error) {
  console.error('migration error:', error)
  process.exitCode = 1
} finally {
  await getAuthDb().destroy()
}
