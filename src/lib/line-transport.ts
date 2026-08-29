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

  /** 429/5xx = ปัญหาชั่วคราว ลองใหม่ได้; 4xx อื่น (เช่น 403 key ผิด) ลองใหม่ก็ไม่หาย */
  get retryable() {
    return this.status === 429 || this.status >= 500
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
