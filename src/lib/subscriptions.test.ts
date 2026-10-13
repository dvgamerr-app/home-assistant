import { expect, test } from 'bun:test'
import { monthlyBahtTotal, parseSubscription, subscriptionBillingDate, type Subscription } from './subscriptions'

const yearly = (date: string): Subscription => ({
  id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  accountId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  service: 'Domain',
  plan: '',
  amountMinor: 1046,
  currency: 'USD',
  billingDay: 6,
  billingInterval: 'yearly',
  billingDate: date,
  status: 'active',
  url: '',
  notes: '',
  version: 1,
  updatedAt: '',
  createdByName: null,
  updatedByName: null,
})

test('annual renewal preserves its month, future start, and leap-day anniversary', () => {
  expect(subscriptionBillingDate(yearly('2026-04-06'), '2026-10-04')).toBe('2027-04-06')
  expect(subscriptionBillingDate(yearly('2026-11-06'), '2026-10-04')).toBe('2026-11-06')
  expect(subscriptionBillingDate(yearly('2026-11-06'), '2026-11-06')).toBe('2026-11-06')
  expect(subscriptionBillingDate(yearly('2024-02-29'), '2025-01-01')).toBe('2025-02-28')
  expect(subscriptionBillingDate(yearly('2024-02-29'), '2028-01-01')).toBe('2028-02-29')
})

test('annual charge is averaged monthly but yearly totals retain the full charge', () => {
  const rate = { usdThb: '35', updatedAt: '', source: '' }
  const items = [yearly('2026-04-06'), { ...yearly('2026-04-06'), billingInterval: 'monthly' as const, amountMinor: 100 }]
  expect(monthlyBahtTotal(items, rate).amountMinor).toBe(6551)
  expect(monthlyBahtTotal(items, rate, true).amountMinor).toBe(78610)
  expect(monthlyBahtTotal(items, null).amountMinor).toBeNull()
})

test('annual billing requires a real calendar date', () => {
  const input = { ...yearly('2026-02-30'), amount: '10.46' }
  expect(() => parseSubscription(input)).toThrow()
  expect(parseSubscription({ ...input, billingDate: '2026-04-06' }).billingInterval).toBe('yearly')
})
