import { isLineNoticeConfigured } from './config'
import { logger } from './logger'

/** งานตรวจหนึ่งอย่างใน cycle — ต้องตั้งชื่อเพื่อให้ log ระบุได้ว่าอันไหนพัง */
export type AlertCheck = {
  name: string
  run: () => Promise<void>
}

/**
 * รัน check ทุกตัวแบบแยก error ออกจากกัน
 *
 * สำคัญ: เดิม cycle ใช้ `await` เรียงกันเฉยๆ ทำให้ถ้า LINE ตอบ 403 ที่ check แรก
 * check ที่เหลือจะไม่ถูกรันเลย และ state ไม่เดินหน้า → alert ตายเงียบทุกรอบ
 * จนกว่าจะมีคนไปดู log
 *
 * @returns จำนวน check ที่ล้มเหลว
 */
export async function runAlertChecks(worker: string, checks: AlertCheck[]) {
  let failed = 0

  for (const check of checks) {
    try {
      await check.run()
    } catch (err) {
      failed += 1
      logger.error({ err, worker, check: check.name }, 'alert check failed')
    }
  }

  if (failed > 0) logger.warn({ worker, failed, total: checks.length }, 'alert cycle finished with failures')
  return failed
}

export type AlertWorkerOptions<Args extends unknown[]> = {
  /** ชื่อที่ใช้ใน log */
  name: string
  /** ข้าม cycle ถ้า LINE ยังไม่ได้ตั้งค่า */
  requiresLineNotice?: boolean
  run: (...args: Args) => Promise<void>
}

/**
 * ครอบ cycle ด้วย re-entrancy guard + LINE config precheck + catch ชั้นนอก
 * (โครงนี้เคยถูกเขียนซ้ำใน energy-alerts.ts และ utility-bill-alerts.ts)
 */
export function createAlertWorker<Args extends unknown[]>(options: AlertWorkerOptions<Args>) {
  let running = false
  let missingConfigLogged = false

  return async function tick(...args: Args) {
    if (running) {
      // เดิม return เงียบๆ ทำให้ cycle ที่ช้ากว่ารอบ poll ข้าม alert แบบไม่มีร่องรอย
      logger.warn({ worker: options.name }, 'previous alert cycle still running, skipping this tick')
      return
    }

    if (options.requiresLineNotice && !isLineNoticeConfigured()) {
      if (!missingConfigLogged) logger.warn({ worker: options.name }, 'alerts disabled: LINE_NOTICE_URL or LINE_NOTICE_API_KEY is missing')
      missingConfigLogged = true
      return
    }
    missingConfigLogged = false

    running = true
    try {
      await options.run(...args)
    } catch (err) {
      logger.error({ err, worker: options.name }, 'alert cycle failed')
    } finally {
      running = false
    }
  }
}
