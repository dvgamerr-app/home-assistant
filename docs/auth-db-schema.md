# Better Auth database schema

ฐานข้อมูลจาก `AUTH_DATABASE_URL` ใช้ PostgreSQL และ migration ปัจจุบันสร้างตารางใน schema `public`:

- `user` — ข้อมูลผู้ใช้ โดย `email` มี unique index
- `account` — วิธีเข้าสู่ระบบที่ผูกกับผู้ใช้ เช่น `github` หรือ `credential`; รหัสผ่านแบบ hash อยู่ในแถว `credential`
- `session` — session ที่อ้างอิง `user.id`
- `verification` — token สำหรับกระบวนการยืนยันตัวตน
- `kysely_migration` และ `kysely_migration_lock` — สถานะ migration

ตาราง `account` และ `session` มี foreign key ไปยัง `user.id` พร้อม `ON DELETE CASCADE` ดู migration ต้นทางที่ `src/db/migrations/001_auth.ts`
