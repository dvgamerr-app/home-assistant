/**
 * สัญญาของ `data-chart` บนกราฟ "กำลังผลิตเทียบค่าสูงสุด"
 *
 * แยกออกมาเป็นไฟล์เพราะ frontmatter (`.astro`) กับ `<script>` ของ Astro
 * เป็นสอง module scope ที่ share type กันตรงๆ ไม่ได้ — ก่อนหน้านี้ฝั่ง script
 * ใช้ `JSON.parse(...)` แล้วอ่าน field แบบ `any` เปลี่ยนชื่อ field ก็ไม่ error
 */
export type SolarRateChartConfig = {
  pv1: number[]
  pv2: number[]
  times: number[]
  pv1MaxKw: number
  pv2MaxKw: number
  isToday: boolean
  socketUrl: string
}
