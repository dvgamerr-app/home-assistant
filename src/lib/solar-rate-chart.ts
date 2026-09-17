/**
 * สัญญาของ `data-solar-rate-chart` บนกราฟ "กำลังผลิตเทียบค่าสูงสุด"
 *
 * แยกออกมาเป็นไฟล์เพราะ frontmatter (`.astro`) กับฝั่ง client
 * เป็นสอง module scope ที่ share type กันตรงๆ ไม่ได้ — ก่อนหน้านี้ฝั่ง script
 * ใช้ `JSON.parse(...)` แล้วอ่าน field แบบ `any` เปลี่ยนชื่อ field ก็ไม่ error
 */
export type SolarRateChartConfig = {
  pv1: number[]
  pv2: number[]
  times: number[]
  pv1MaxKw: number
  pv2MaxKw: number
  /** วันที่กำลังดู กับขอบเขตที่เลื่อนย้อนหลังได้ — ใช้ตั้ง viewport เริ่มต้นและโหลดวันอื่นเพิ่ม */
  selectedDate: string
  today: string
  historyStart: string
  isToday: boolean
  socketUrl: string
}
