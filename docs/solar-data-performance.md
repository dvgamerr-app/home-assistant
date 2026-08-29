# Solar data performance profile

สำรวจ collector PostgreSQL แบบ read-only เมื่อ 2026-08-17 และตรวจซ้ำหลัง initial backfill เมื่อ 2026-08-24 เพื่อกำหนดแนวทาง query, cache และการเลือก source จากลักษณะข้อมูลจริง

## Data shape

- หลัง initial backfill `stash.solar_record` มีประมาณ 5.44 ล้านแถว รวม table และ index ราว 1.4 GB
- อุปกรณ์ที่ใช้งานมี 24 attributes, 26,417 source timestamps ช่วง 2026-05-11 ถึง 2026-08-17
- ข้อมูลปัจจุบันส่งมาพร้อมกันราว 23 attributes ต่อ sample
- cadence 14 วันล่าสุด: median 301 วินาที, p90 360 วินาที; วันเต็มมีประมาณ 269–278 samples
- `stash.mea_electric` มีเพียง 19 แถว ส่วนตาราง MWA มีขนาดเล็กมาก จึงไม่ใช่คอขวดหลัก

## Display source mapping

- กำลังผลิตตามเวลายังใช้ `stash.solar_record` เพราะเป็น telemetry ที่มี timestamp จริง
- พลังงานที่ผลิตรายวันใช้ `stash.solar_station_summary` โดยกำหนด `source = 'category_monthly'`, `category_key = 'pvInverterElectricityQuantityClass'` และ `attr = 'pvGeneratedEnergy'`
- พลังงานที่ผลิตรายเดือนใช้ source เดียวกันที่ระดับ `category_yearly`; ยอดสะสมใช้ `source = 'generated_total'` และ `attr = 'generatedEnergy'`
- ใช้เฉพาะ station summary ที่ `is_real_value IS NOT FALSE`; future bucket ที่ upstream ส่งเป็น placeholder ต้องไม่ตีความเป็นค่าศูนย์จริง
- `consumeElectricityQuantity` และ `buyElectricityQuantity` ใน station summary ที่สำรวจเป็น placeholder ทั้งหมด จึงใช้ `loadDayElectricityConsumption` และ `dayPurchaseElectricityConsumption` จาก telemetry สำหรับยอดใช้ไฟและซื้อไฟ
- สถานะแบตเลือก `value_display` จาก latest/energy-flow state ในรอบข้อมูลล่าสุดก่อน raw code จาก key history เพื่อให้แสดง `Idle` แทน `011` แต่ `Idle` หมายถึงไม่มีกำลังไหล ไม่ได้ยืนยันว่าแบตเชื่อมต่อ หน้าเว็บจึงตรวจ active alarm, กำลัง/กระแส และแรงดันขั้นต่ำของระบบร่วมด้วยก่อนแสดง SOC/SOH หรือคำนวณพลังงานสำรอง

วันที่ 2026-08-24 การหัก `MAX(totalPowerGeneration) - MIN(totalPowerGeneration)` ให้ผล `6.131 kWh` ขณะที่ station summary และ device snapshot ตรงกันที่ `5.581 kWh` หน้าเว็บจึงไม่ใช้ผลต่างตัวนับสะสมเป็นยอดผลิตรายวันอีกต่อไป

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
