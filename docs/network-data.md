# network-data — ข้อมูลเครือข่ายในบ้าน (`stash.pingstats`)

บันทึกสิ่งที่ตรวจสอบจาก collector DB จริงเมื่อ 17 ก.ย. 2026 เพื่อใช้ต่อหน้า `/network` เข้ากับข้อมูลจริง
ตอนนี้หน้านั้นยังเป็น mock — ตัวเลขมาจาก `src/lib/network-mock.ts` ไม่ได้ query DB

## ตารางต้นทาง

```sql
stash.pingstats            -- partition RANGE (ts), แบ่งรายสัปดาห์ เช่น stash.pingstats_2026w38
  ts             timestamptz
  host           text       -- เครื่องที่ยิง ping (ตอนนี้มีตัวเดียว: AIDE-RYZEN)
  section        text       -- จุดตรวจ: 'Local' | 'WAN (Internet)' | 'DNS' | 'Singapore'
  latency_ms     double precision
  error_code     integer
  status_code    integer
  responder      text       -- IP ที่ตอบกลับ
  sys_latency_ms integer    -- ค่าที่ระบบปฏิบัติการรายงาน (ปัดเป็นจำนวนเต็ม)
```

index: `(ts, host, section)` — query ต้องมี `ts` เป็นเงื่อนไขแรกเสมอ ไม่งั้นสแกนทั้ง partition

## สิ่งที่วัดได้จริง

| section        | responder    | latency เฉลี่ย | ความหมายต่อเจ้าของบ้าน            |
| -------------- | ------------ | -------------- | --------------------------------- |
| Local          | 10.203.1.91  | ~0.5 ms        | สายในบ้าน/Wi-Fi ถึงเราเตอร์       |
| WAN (Internet) | 171.6.8.1    | ~6.6 ms        | ทางออกไปเครือข่ายผู้ให้บริการ     |
| DNS            | 1.1.1.1      | ~6.7 ms        | ระบบแปลชื่อเว็บ                   |
| Singapore      | 139.162.23.4 | ~32.5 ms       | เส้นทางออกนอกประเทศ               |

- **cadence 0.5 วินาทีต่อ section** (ยืนยันแล้ว: avg gap = 0.500s) → ~691,200 แถว/วัน รวมทุก section
- ข้อมูลเริ่มเก็บ 17 ก.ย. 2026 08:28 — ยังไม่มีข้อมูลย้อนหลังหลายวัน กราฟ 24 ชม. จะเต็มก็ต่อเมื่อเก็บครบวัน

## ข้อควรระวังตอนเขียน query จริง

1. **แพ็กเก็ตหายไม่ได้อยู่ที่ `error_code`** — ทุกแถวที่มีตอนนี้เป็น `error_code = 0, status_code = 0` ทั้งหมด
   แต่ `WAN (Internet)` มีจำนวนแถวน้อยกว่า section อื่น 2 แถวในช่วงเดียวกัน แปลว่ารอบที่ ping ไม่สำเร็จ
   collector **ไม่บันทึกแถว** → loss ต้องคำนวณจาก "แถวที่หายไป" เทียบกับจำนวนรอบที่ควรมี ไม่ใช่ `count(*) FILTER (WHERE error_code <> 0)`
   ควรยืนยันพฤติกรรมนี้อีกครั้งเมื่อเกิดเน็ตหลุดจริง ก่อนเอาไปคิดเป็น uptime
2. **อย่า `SELECT *` ทั้งวัน** — 0.5 วินาที/section ทำให้ 24 ชม. เป็นหลักแสนแถว ต้อง aggregate ใน SQL
   ให้เหลือระดับ 5–10 นาที ก่อนส่งเข้าหน้าเว็บ (หน้า mock ใช้ bucket 10 นาที = 144 จุด/เส้น)
3. **partition รายสัปดาห์** — query ข้ามสัปดาห์จะแตะหลาย partition ตามปกติของ Postgres ไม่ต้องทำอะไรพิเศษ
   แต่ถ้า collector ไม่ได้สร้าง partition ของสัปดาห์ถัดไปไว้ล่วงหน้า การ insert จะพัง — เป็นความเสี่ยงฝั่ง collector ไม่ใช่ฝั่งเว็บ

## query ที่หน้า `/network` ต้องใช้ (ร่าง)

bucket 10 นาที สำหรับกราฟ 24 ชม. และตารางสรุป:

```sql
SELECT date_bin('10 minutes', ts, now() - interval '24 hours') AS bucket,
       section,
       avg(latency_ms)                                   AS avg_ms,
       percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95_ms,
       max(latency_ms)                                   AS max_ms,
       count(*)                                          AS samples
FROM stash.pingstats
WHERE ts >= now() - interval '24 hours'
  AND host = $1
GROUP BY 1, 2
ORDER BY 1, 2;
```

- **loss ต่อ bucket** = `1 - samples / (600 / 0.5)` (ตามข้อ 1 ข้างบน) — bucket ที่ `samples = 0` คือช่วงที่ ping ไม่ตอบเลย
- **ค่าล่าสุดต่อ section** ใช้ `DISTINCT ON (section) ... ORDER BY section, ts DESC` แบบเดียวกับที่ `solar_record` ทำ
- **jitter** ใช้ `avg(abs(latency_ms - median))` หรือ `stddev_samp(latency_ms)` ต่อ bucket แล้วเฉลี่ยอีกที

## สิ่งที่ยังไม่มีข้อมูล

- **รายชื่ออุปกรณ์ที่ต่ออยู่ในบ้าน** (ใครออนไลน์ อุปกรณ์ไหนกินแบนด์วิดท์) — ต้องให้ collector ดึงตาราง DHCP/ARP
  จากเราเตอร์เข้ามาเก็บก่อน หน้า mock เว้นการ์ดนี้ไว้เป็น empty state แล้ว
- **ความเร็วเน็ต (Mbps)** — `pingstats` วัดแค่ความหน่วง ไม่ได้วัด throughput ถ้าจะแสดงต้องมี speedtest แยก
