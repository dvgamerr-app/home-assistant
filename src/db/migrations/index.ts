import type { Migration } from 'kysely/migration'
import * as m001 from './001_auth'
import * as m002 from './002_two_factor'
import * as m003 from './003_alert_state'
import * as m004 from './004_account_issuer'
import * as m005 from './005_relax_account_issuer'
import * as m006 from './006_subscriptions'
import * as m007 from './007_subscription_yearly'

// import ตรงๆ แทนการอ่านโฟลเดอร์ด้วย FileMigrationProvider — ตอน build โค้ดถูก bundle
// เป็นไฟล์เดียว ทำให้ไม่มีโฟลเดอร์ migrations ให้อ่านตอน runtime
// ชื่อ key ต้องตรงกับชื่อที่เคยบันทึกในตาราง kysely_migration (ห้ามเปลี่ยน) และเรียงตามตัวอักษร
// migration ใหม่: เพิ่มไฟล์แล้วเติมบรรทัดที่นี่
export const migrations: Record<string, Migration> = {
  '001_auth': m001,
  '002_two_factor': m002,
  '003_alert_state': m003,
  '004_account_issuer': m004,
  '005_relax_account_issuer': m005,
  '006_subscriptions': m006,
  '007_subscription_yearly': m007,
}
