import pg from 'pg'

const client = new pg.Client({
  connectionString: 'postgres://r00t:osUmAet246qo@10.203.1.91:5432/dev_collector',
})
await client.connect()

// 1) device_ids ทั้งหมด
const devices = await client.query('SELECT DISTINCT device_id, COUNT(*) as rows FROM stash.solar_record GROUP BY device_id ORDER BY rows DESC')
console.log('\n=== SOLAR DEVICE IDs ===')
console.table(devices.rows)

// 2) attr ทั้งหมดพร้อมค่าล่าสุด
const attrs = await client.query(`
  SELECT DISTINCT ON (attr) attr, value, recorded_at
  FROM stash.solar_record
  ORDER BY attr, recorded_at DESC
`)
console.log('\n=== ATTR NAMES + LATEST VALUES ===')
console.table(attrs.rows)

// 3) MEA meters
const meters = await client.query('SELECT ca, ui, alias, updated_at FROM stash.mea_meter ORDER BY updated_at DESC')
console.log('\n=== MEA METERS ===')
console.table(meters.rows)

// 4) MEA latest bills
const bills = await client.query(`
  SELECT ca, month, kwh, paid, unit_used_solar, amount_used_solar, income
  FROM stash.mea_electric
  ORDER BY month DESC LIMIT 10
`)
console.log('\n=== MEA LATEST BILLS ===')
console.table(bills.rows)

await client.end()
