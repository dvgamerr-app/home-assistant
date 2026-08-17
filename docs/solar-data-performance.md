# Solar data performance profile

สำรวจ collector PostgreSQL แบบ read-only เมื่อ 2026-08-17 เพื่อกำหนดแนวทาง query และ cache จากลักษณะข้อมูลจริง

## Data shape

- `stash.solar_record` มีประมาณ 604,592 แถว รวม table และ index ราว 150 MB
- อุปกรณ์ที่ใช้งานมี 24 attributes, 26,417 source timestamps ช่วง 2026-05-11 ถึง 2026-08-17
- ข้อมูลปัจจุบันส่งมาพร้อมกันราว 23 attributes ต่อ sample
- cadence 14 วันล่าสุด: median 301 วินาที, p90 360 วินาที; วันเต็มมีประมาณ 269–278 samples
- `stash.mea_electric` มีเพียง 19 แถว ส่วนตาราง MWA มีขนาดเล็กมาก จึงไม่ใช่คอขวดหลัก

## Existing indexes

- Primary key: `(device_id, attr, recorded_at)`
- Time index: `(device_id, recorded_at)`

สอง index นี้เพียงพอกับ workload ปัจจุบันเมื่อ filter เวลาเป็น range บน `recorded_at` โดยตรง ไม่ต้องเพิ่ม index ใหม่

## Measured plans

ค่าจาก `EXPLAIN (ANALYZE, BUFFERS)` บนข้อมูลจริง:

| Query | เดิม | หลังปรับ | สาเหตุหลัก |
| --- | ---: | ---: | --- |
| latest snapshot | 417 ms | 1.0 ms | จาก sort 604k แถวและ spill ลง disk เป็น backward index seek ล่าสุดต่อ 19 attributes |
| five-minute chart วันนี้ | 70.7 ms | 3.3 ms | จาก parallel sequential scan เป็น timestamp range บน composite PK |
| daily totals เดือนปัจจุบัน | 59.5 ms | 33.0 ms | ตัด `to_char(recorded_at, ...)` ใน `WHERE` แล้วใช้ timestamp range |
| `getAll()` ฝั่งแอป (warm DB) | 388–400 ms | ประมาณ 139 ms ก่อน cache | รวมผลจาก query plan ใหม่และลด query ซ้ำ |

`pg_stat_user_tables` เคยสะสม sequential scans 30,245 ครั้งและอ่านรวมราว 8.25 พันล้าน tuples ซึ่งสอดคล้องกับ date predicate เดิมที่ใช้ index ไม่ได้

## Runtime policy

- SSR แยก scope ตามหน้า: overview, load, solar และ bill ไม่ดึง dataset ที่หน้าไม่ได้ใช้
- cache ใน process รวม concurrent reads และตั้ง TTL ตามความผันผวน: live 5 วินาที, วันปัจจุบัน 30–60 วินาที, ประวัติ 6 ชั่วโมง, aggregate/bill 5 นาที
- socket ตรวจ source timestamp ทุกนาที แต่ query/emit กราฟเมื่อ timestamp เปลี่ยนเท่านั้น
- Energy alert ใช้รอบ 5 นาทีตาม cadence ของ source
- utility bill alert ตรวจหนึ่งครั้งตอน process เริ่ม จากนั้นตรวจรายชั่วโมงเฉพาะ MEA วันที่ 12–13 และ MWA วันที่ 22–23 ตามเวลาไทย
- cache เป็น per-process; Astro SSR และ socket standalone ไม่แชร์ memory กัน

## Operational note

วันที่สำรวจ `solar_record` มี estimated dead tuples ราว 111k จาก live tuples ราว 605k และมี auto-analyze ล่าสุดแล้ว ควรติดตาม autovacuum/table growth ต่อไป แต่การสำรวจนี้ไม่ได้รัน `VACUUM`, เพิ่ม index หรือแก้ schema ใด ๆ
