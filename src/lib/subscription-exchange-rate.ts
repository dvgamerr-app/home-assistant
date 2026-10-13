import { getSubscriptionExchangeRate } from './db'
import { cacheData } from './data-cache'
import { logger } from './logger'
import type { SubscriptionExchangeRate } from './subscriptions'

export async function getSubscriptionRate(): Promise<SubscriptionExchangeRate | null> {
  try {
    return await cacheData('subscription:usd-thb', 60_000, async () => {
      const row = await getSubscriptionExchangeRate()
      const rate = Number(row?.usd_buy)
      if (!row || !Number.isFinite(rate) || rate <= 0 || rate > 1000 || !Number.isFinite(new Date(row.updated_at).getTime())) return null
      return { usdThb: rate.toFixed(8), updatedAt: new Date(row.updated_at).toISOString(), source: 'YLG' }
    })
  } catch (error) {
    logger.warn({ err: error }, 'subscription exchange rate unavailable')
    return null
  }
}
