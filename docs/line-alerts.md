# LINE alerts

Worker ทำงานใน `server/socket.mjs` ทุก 60 วินาที และส่ง Flex Message ผ่าน LINE Manager external API โดยไม่ใช้ Discord แบ่งเป็น `energy-alerts.ts` สำหรับ Energy Lib และ `utility-bill-alerts.ts` สำหรับค่าไฟ/ค่าน้ำ โดยไม่อ้างอิงแบรนด์ Energy Lib

request body ของ external API ใช้ `{"messages":[<LINE Flex Message>]}` เพื่อส่ง LINE message object โดยตรง ฟิลด์ `message` ใช้สำหรับข้อความ text เท่านั้น

## เงื่อนไข

- อุปกรณ์ offline เมื่อข้อมูลล่าสุดเก่ากว่า 15 นาที และแจ้งอีกครั้งเมื่อกลับมา online
- alarm ของอินเวอร์เตอร์ (`stash.solar_alarm` ที่ `cleared_at IS NULL`) แจ้งเมื่อชุด alarm เปลี่ยน และแจ้ง recovery เมื่อเคลียร์ครบ — **ไม่แสดงบนหน้าเว็บแล้ว ส่งเข้า LINE ทางเดียว**
- หลัง 09:00 แจ้งเมื่อ SOC สูงสุดช่วง 06:00–09:00 ยังไม่เกินค่า reserve (`15%` โดย default)
- หลัง 18:00 แจ้งทันทีเมื่อ SOC ยังไม่ลดต่ำกว่า `95%` (`ENERGY_ALERT_BATTERY_EVENING_MAX_PCT`)
- หลัง 09:00 รวมพลังงานของ `pv1Power` และ `pv2Power` แยกชุดช่วง 06:00–09:00 แล้วเทียบค่าเฉลี่ยรายวันของเดือนฐาน ค่าเฉลี่ยรวมวันที่ไม่มีข้อมูลเป็น `0`
- แจ้งเมื่อพบเลขบิล MEA หรือ MWA รอบใหม่ หลังรอบแรก worker จะบันทึกบิลปัจจุบันเป็น baseline โดยไม่ส่งบิลย้อนหลัง

## Schedule

- `server/socket.mjs` เรียก worker ทันทีตอน process เริ่ม แล้วเรียกซ้ำทุก `60,000 ms` ด้วย `setInterval`; ไม่ได้ใช้ cron
- device online/offline ตรวจทุก tick และถือว่า offline เมื่อข้อมูลล่าสุดเก่ากว่า 15 นาที
- alarm ของอินเวอร์เตอร์ตรวจทุก tick เช่นกัน แต่เฉพาะตอนออนไลน์ เพราะตอน offline ข้อมูล alarm ค้างอยู่กับค่าเดิม
- battery morning และ solar เริ่มตรวจตั้งแต่ 09:00 เป็นต้นไป โดยคำนวณเวลาด้วย timezone `Asia/Bangkok`
- battery evening เริ่มตรวจตั้งแต่ 18:00 เป็นต้นไป
- เวลาเริ่มตรวจตั้งไว้ที่ `MORNING_ALERT_MINUTE = 9 * 60` และ `EVENING_ALERT_MINUTE = 18 * 60` ใน `src/lib/energy-alerts.ts`

Alert ของ Energy Lib ใช้ `public/lib.png` ผ่าน `ENERGY_LIB_AVATAR_URL`

Energy Lib Flex ใช้ bubble ขนาด `giga` แสดงเฉพาะหัวข้อและค่าประกอบ ไม่มีข้อความ detail และทั้ง 4 เงื่อนไขส่ง recovery เฉพาะเมื่อสถานะล่าสุดเป็นปัญหามาก่อน: device online หลัง offline, แบตเตอรี่เริ่มชาร์จหลังเคยไม่ชาร์จ, โซลาร์กลับมาผลิตตามเกณฑ์หลังเคยผลิตต่ำ และแบตเตอรี่ลดต่ำกว่าเกณฑ์หลัง 18:00 หลังเคยสูงกว่าเกณฑ์ โดย recovery ของเงื่อนไขรายวันสามารถเกิดในวันถัดไปได้หากวันก่อนยังค้างสถานะ `alert`

บิลเป็น sender อิสระ: `ค่าไฟ` ใช้ `public/mea.png` และ `ค่าน้ำ` ใช้ `public/mwa.png` โดยอ้าง URL deploy `https://home.ourkk.com/mea.png` และ `https://home.ourkk.com/mwa.png` โดยตรง ไม่มีข้อความหรือ config ของ Energy Lib อยู่ใน payload บิล

บิล MEA และ MWA ใช้ Flex ขนาด `mega` โดยใช้ `ค่าไฟ` / `ค่าน้ำ` เป็น display name และไม่มี header ซ้ำในตัวการ์ด เนื้อหาแสดงเฉพาะยอดชำระ รอบบิล ปริมาณที่ใช้ วันออกบิล และกำหนดชำระ

ค่าตั้งต้นเดือนฐาน `2026-07` จากข้อมูลจริงคือ MPPT 1 `2.631 kWh` และ MPPT 2 `0.586 kWh`; worker query ค่านี้ใหม่จากฐานข้อมูลและไม่ hard-code ตัวเลขดังกล่าว

ตัวเลขฐานชุดนี้เป็นค่าของการจัดสายแบบเดิม (MPPT 1 `11` แผง · MPPT 2 `4` แผง) ตั้งแต่ `2026-09-17` ย้ายเป็น MPPT 1 `10` แผง · MPPT 2 `5` แผง ทำให้ฐานของ MPPT 1 สูงกว่ากำลังจริงราว 10% และฐานของ MPPT 2 ต่ำกว่าจริงราว 20% — เกณฑ์ `ENERGY_ALERT_SOLAR_MIN_RATIO` ที่ `0.2` ยังกว้างพอจะไม่แจ้งผิด แต่เมื่อมีเดือนเต็มเดือนแรกหลังจัดสาย (`2026-10`) ควรตั้ง `ENERGY_ALERT_SOLAR_BASELINE_MONTH=2026-10` เพื่อให้ฐานตรงกับ layout ปัจจุบัน

## การกันแจ้งซ้ำ

สถานะอยู่ในตารางกลาง `public.alert_state` ของ auth DB ซึ่งสร้างด้วย migration `003_alert_state.ts` เงื่อนไขรายวันส่งได้สูงสุดหนึ่งครั้งต่อวัน ส่วน online/offline ส่งเฉพาะเมื่อสถานะเปลี่ยน และบิลส่งเฉพาะเมื่อ identity ของบิลเปลี่ยน

alarm ของอินเวอร์เตอร์ใช้คีย์ `inverter-alarm` และเก็บลายเซ็นของ alarm ที่ยังไม่เคลียร์ (รหัส alarm เรียงแล้วคั่นด้วย `,`) ไว้ใน `last_value` — alarm ชุดเดิมจะไม่ส่งซ้ำ แต่ถ้ามี alarm ตัวใหม่เพิ่มเข้ามาถือว่าเป็นชุดใหม่และส่งอีกครั้ง

ก่อนเปิด worker ต้องรัน `bun run migration:run` และตั้ง `LINE_NOTICE_URL` กับ `LINE_NOTICE_API_KEY` ใน secret/environment ของ runtime

## หมายเหตุ schema

`stash.solar_record` ไม่มี attribute ค่า battery reserve/config มีเพียง `batterySOC`, `batterySOH`, `batteryPower`, `batteryVoltage` และ `batteryCurrent` จึงกำหนด reserve สำหรับ alert ผ่าน `ENERGY_ALERT_BATTERY_RESERVE_PCT`
