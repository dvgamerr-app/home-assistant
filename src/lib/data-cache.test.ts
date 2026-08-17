import { afterEach, describe, expect, test } from 'bun:test'
import { cacheData, clearDataCache } from './data-cache'

describe('cacheData', () => {
  afterEach(clearDataCache)

  test('coalesces concurrent loads for the same key', async () => {
    let calls = 0
    const loader = async () => {
      calls += 1
      return calls
    }

    const [first, second] = await Promise.all([cacheData('same', 1_000, loader), cacheData('same', 1_000, loader)])

    expect(first).toBe(1)
    expect(second).toBe(1)
    expect(calls).toBe(1)
  })

  test('does not retain rejected loads', async () => {
    let calls = 0
    const loader = async () => {
      calls += 1
      if (calls === 1) throw new Error('temporary failure')
      return calls
    }

    let failure: unknown
    try {
      await cacheData('retry', 1_000, loader)
    } catch (error) {
      failure = error
    }

    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toBe('temporary failure')
    expect(await cacheData('retry', 1_000, loader)).toBe(2)
  })
})
