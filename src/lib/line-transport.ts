import { config, isLineNoticeConfigured } from './config'
import { logger } from './logger'
import { truncate } from './line-flex'

/** ความผิดพลาดจาก LINE notice endpoint พร้อมข้อมูลพอที่ caller จะแยก retryable ได้ */
export class LineNoticeError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`LINE notice request failed (${status}): ${body}`)
    this.name = 'LineNoticeError'
  }

  /**
   * ลองใหม่ได้: 429 (ถูก throttle), 5xx (ปลายทางพัง) และ **403**
   *
   * 403 ดูเหมือน "key ผิด" แต่จากของจริง 28/08/2026: บิลน้ำโดน 403 ตอน 20:07
   * แล้ว key ตัวเดิมส่งผ่านตอน 21:36 → LINE notice endpoint ตอบ 403 ตอนที่
   * ปลายทาง (LINE Manager) ไม่พร้อมด้วย ไม่ใช่แค่ตอน key ผิด จึงต้อง retry
   * ถ้า key ผิดจริงก็แค่เสียเวลา ~5 วิ ต่อการส่ง แต่ได้กลับมาไวขึ้นมากเวลาปลายทางสะดุด
   *
   * ไม่ลองใหม่: 400/401/404/422 ฯลฯ ที่เป็นความผิดของ payload เราเอง
   */
  get retryable() {
    return this.status === 429 || this.status === 403 || this.status >= 500
  }
}

/** หน่วงก่อน retry — ความยาว array = จำนวนครั้งที่ยอมลองซ้ำ */
export const RETRY_DELAYS_MS = [1_000, 4_000]
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function postOnce(messages: unknown[]) {
  const response = await fetch(config.line.url, {
    method: 'POST',
    headers: {
      'X-API-Key': config.line.apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ messages }),
    signal: AbortSignal.timeout(15_000),
  })

  if (!response.ok) throw new LineNoticeError(response.status, truncate(await response.text(), 500))
}

export async function sendLineMessages(messages: unknown[], { retryDelaysMs = RETRY_DELAYS_MS }: { retryDelaysMs?: number[] } = {}) {
  if (!isLineNoticeConfigured()) throw new Error('LINE notice endpoint is not configured')

  for (let attempt = 0; ; attempt += 1) {
    try {
      await postOnce(messages)
      return
    } catch (err) {
      const retryable = err instanceof LineNoticeError ? err.retryable : true
      const delay = retryDelaysMs[attempt]
      if (!retryable || delay === undefined) throw err

      logger.warn({ err, attempt: attempt + 1, delay }, 'LINE notice failed, retrying')
      await sleep(delay)
    }
  }
}
