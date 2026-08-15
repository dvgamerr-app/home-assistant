# MWA water data

ข้อมูลการใช้น้ำอยู่ใน PostgreSQL collector ที่ `stash.mwa_water` และเลือกบัญชีจาก `stash.mwa_account` เมื่อไม่ได้ตั้ง `MWA_ACCOUNT_CODE`

หนึ่ง `period_year`/`period_month` อาจมีหลายแถว เพราะค่าธรรมเนียมหรือรายการรับชำระแยกจากบิลค่าน้ำ รายการเหล่านั้นอาจมี `consumption = 0` และไม่มี `current_read_date` ดังนั้น query ปริมาณใช้น้ำต้องกรอง `current_read_date IS NOT NULL` และเลือกหนึ่งแถวล่าสุดต่อรอบเดือน

ยอดบิลรวมอยู่ใน `gross_amount`, ภาษีอยู่ใน `vat_amount`, ยอดที่จ่ายจริงอยู่ใน `paid_amount` และยอดคงเหลืออยู่ใน `balance_gross_amount` หน้าเว็บถือว่าชำระครบเมื่อมี `paid_date`, `paid_amount > 0` และยอดคงเหลือไม่เกิน 0 โดยไม่อิง `payment_flag` ซึ่งความหมายไม่ชัดจาก schema

ดัชนี `ix_mwa_water_period (account_code, period_year, period_month)` รองรับการกรองบัญชีและเรียงรอบเดือน
