/// <reference types="bun" />
import { afterEach, describe, expect, test } from 'bun:test'
import { config } from './config'
import { LineNoticeError, sendLineMessages } from './line-transport'

type Capture = { url: string; init: RequestInit }

const captured: Capture[] = []
const realFetch = globalThis.fetch
/** retry ทันทีเพื่อไม่ให้ test รอจริง */
const noDelay = { retryDelaysMs: [0, 0] }

/** แทน fetch ด้วยคิวของ response ที่กำหนดไว้ล่วงหน้า */
function stubFetch(responses: Array<{ status: number; body?: string }>) {
  const queue = [...responses]
  globalThis.fetch = ((url: string, init: RequestInit) => {
    captured.push({ url: String(url), init })
    const next = queue.shift() ?? { status: 200 }
    return Promise.resolve(new Response(next.body ?? '', { status: next.status }))
  }) as typeof fetch
}

afterEach(() => {
  globalThis.fetch = realFetch
  captured.length = 0
})

describe('sendLineMessages', () => {
  test('posts the messages array as the request envelope', async () => {
    stubFetch([{ status: 200 }])

    await sendLineMessages([{ type: 'flex', altText: 'ทดสอบ' }])

    expect(captured).toHaveLength(1)
    expect(captured[0]!.url).toBe(config.line.url)
    expect(captured[0]!.init.method).toBe('POST')
    expect((captured[0]!.init.headers as Record<string, string>)['X-API-Key']).toBe(config.line.apiKey)
    // นี่คือ envelope จริงที่วิ่งออกไป ไม่ใช่ helper ที่ production ไม่ได้ใช้
    expect(JSON.parse(String(captured[0]!.init.body))).toEqual({ messages: [{ type: 'flex', altText: 'ทดสอบ' }] })
  })

  test('403 is permanent — throws immediately without retrying', async () => {
    stubFetch([{ status: 403, body: '{"errorCode":403}' }])

    const error = await sendLineMessages([{}], noDelay).catch((err: unknown) => err)

    expect(error).toBeInstanceOf(LineNoticeError)
    expect((error as LineNoticeError).status).toBe(403)
    expect((error as LineNoticeError).retryable).toBe(false)
    expect(captured).toHaveLength(1)
  })

  test('5xx is transient — retries and succeeds', async () => {
    stubFetch([{ status: 502, body: 'bad gateway' }, { status: 200 }])

    await sendLineMessages([{}], noDelay)

    expect(captured).toHaveLength(2)
  })

  test('gives up after the retry budget and reports the last status', async () => {
    stubFetch([
      { status: 500, body: 'a' },
      { status: 500, body: 'b' },
      { status: 500, body: 'c' },
    ])

    const error = await sendLineMessages([{}], noDelay).catch((err: unknown) => err)

    expect((error as LineNoticeError).status).toBe(500)
    expect((error as LineNoticeError).body).toBe('c')
    expect(captured).toHaveLength(3)
  })
})
