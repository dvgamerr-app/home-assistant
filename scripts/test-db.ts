import '../src/lib/db.ts' // side-effect: load env validation

// Manual load .env since bun may not auto-load in script context
// Re-import after env is set
import { getLiveSnapshot, getToday, getLifetime, getBills } from '../src/lib/db.ts'

const live = await getLiveSnapshot()
console.log('LIVE:', live)

const today = await getToday()
console.log('TODAY:', today)

const lifetime = await getLifetime()
console.log('LIFETIME:', lifetime)

const bills = await getBills(3)
console.log('BILLS (3):', bills)

process.exit(0)
