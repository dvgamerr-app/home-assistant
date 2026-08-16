import { describe, expect, test } from 'bun:test'
import { getBangkokClock, getConnectionTransition, getDailyConditionTransition, getDefaultSolarBaselineMonth, getUnderperformingMppts, shouldAlertEveningBattery } from './energy-alerts'
import { buildEnergyFlexMessage, buildEnergyNoticeRequest } from './line-notice'

describe('Energy Lib alert rules', () => {
  test('uses the most recent July as the solar baseline', () => {
    expect(getDefaultSolarBaselineMonth('2026-08-16')).toBe('2026-07')
    expect(getDefaultSolarBaselineMonth('2026-02-01')).toBe('2025-07')
  })

  test('evaluates time in Bangkok', () => {
    expect(getBangkokClock(new Date('2026-08-16T02:00:00.000Z'))).toEqual({ day: '2026-08-16', minuteOfDay: 540 })
  })

  test('identifies each MPPT below the configured baseline ratio', () => {
    const failures = getUnderperformingMppts({ pv1Kwh: 0.2, pv2Kwh: 0.4 }, { month: '2026-07', days: 31, pv1Kwh: 2.631, pv2Kwh: 0.586 }, 0.2)

    expect(failures.map((failure) => failure.name)).toEqual(['MPPT 1'])
  })

  test('alerts after 18:00 while battery SOC has not fallen below 95%', () => {
    expect(shouldAlertEveningBattery(96, 95)).toBe(true)
    expect(shouldAlertEveningBattery(95, 95)).toBe(true)
    expect(shouldAlertEveningBattery(94.9, 95)).toBe(false)
  })

  test('sends recovery only after an existing alert state', () => {
    expect(getDailyConditionTransition(null, '2026-08-16', false)).toBe('record-normal')
    expect(getDailyConditionTransition({ status: 'normal', lastValue: '2026-08-16' }, '2026-08-16', false)).toBe('none')
    expect(getDailyConditionTransition({ status: 'alert', lastValue: '2026-08-16' }, '2026-08-16', false)).toBe('recovery')
    expect(getDailyConditionTransition({ status: 'normal', lastValue: '2026-08-16' }, '2026-08-16', true)).toBe('alert')
    expect(getDailyConditionTransition({ status: 'alert', lastValue: '2026-08-15' }, '2026-08-16', false)).toBe('recovery')
    expect(getDailyConditionTransition({ status: 'normal', lastValue: '2026-08-15' }, '2026-08-16', false)).toBe('record-normal')
  })

  test('sends online recovery only after an offline state', () => {
    expect(getConnectionTransition(null, 'online')).toBe('record-online')
    expect(getConnectionTransition('online', 'online')).toBe('none')
    expect(getConnectionTransition('offline', 'online')).toBe('recovery')
    expect(getConnectionTransition('online', 'offline')).toBe('alert')
  })
})

describe('Energy Lib Flex Message', () => {
  test('builds a LINE Flex bubble with accessible alternative text', () => {
    const message = buildEnergyFlexMessage(
      {
        tone: 'warning',
        title: 'แบตเตอรี่ยังไม่เริ่มชาร์จ',
        fields: [{ label: 'SOC', value: '15%' }],
      },
      new Date('2026-08-16T02:00:00.000Z'),
    )

    expect(message.type).toBe('flex')
    expect(message.sender.name).toBe('Energy Lib')
    expect(message.sender.iconUrl).toMatch(/^https:\/\//)
    expect(message.altText).toBe('แบตเตอรี่ยังไม่เริ่มชาร์จ')
    expect(message.contents.type).toBe('bubble')
    expect(message.contents.size).toBe('giga')
    expect(message.contents.body.contents).toHaveLength(1)
    expect(message.contents.header.contents).toHaveLength(1)
    expect(JSON.stringify(message)).not.toContain('detail')
  })

  test('wraps LINE message objects in the external API messages array', () => {
    const request = buildEnergyNoticeRequest({ tone: 'info', title: 'สถานะระบบ' })

    expect(request).toHaveProperty('messages')
    expect(request.messages).toHaveLength(1)
    expect(request.messages[0].type).toBe('flex')
    expect(request).not.toHaveProperty('message')
  })
})
