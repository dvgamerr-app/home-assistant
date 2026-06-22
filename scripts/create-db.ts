import pg from 'pg'

const client = new pg.Client({
  connectionString: 'postgres://r00t:osUmAet246qo@10.203.1.91:5432/postgres',
})
await client.connect()
const res = await client.query("SELECT 1 FROM pg_database WHERE datname='ourkk'")
if (res.rowCount === 0) {
  await client.query('CREATE DATABASE ourkk')
  console.log('DB ourkk created')
} else {
  console.log('DB ourkk already exists')
}
await client.end()
