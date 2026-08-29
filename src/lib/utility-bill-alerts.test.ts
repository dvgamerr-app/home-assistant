import { describe, expect, test } from 'bun:test'
import { getScheduledUtilityBillTypes, type UtilityBillSchedule } from './utility-bill-alerts'
import { buildUtilityBillFlexMessage } from './utility-line-notice'

const schedule: UtilityBillSchedule = { electricityDay: 12, waterDay: 22, graceDays: 1 }

describe('Utility bill alert schedule', () => {
  test('checks MEA on Bangkok dates 12-13 only', () => {
    expect(getScheduledUtilityBillTypes(new Date('2026-08-11T17:00:00Z'), schedule)).toEqual(['electricity'])
    expect(getScheduledUtilityBillTypes(new Date('2026-08-13T16:59:59Z'), schedule)).toEqual(['electricity'])
    expect(getScheduledUtilityBillTypes(new Date('2026-08-13T17:00:00Z'), schedule)).toEqual([])
  })

  test('checks MWA on Bangkok dates 22-23 only', () => {
    expect(getScheduledUtilityBillTypes(new Date('2026-08-21T17:00:00Z'), schedule)).toEqual(['water'])
    expect(getScheduledUtilityBillTypes(new Date('2026-08-23T16:59:59Z'), schedule)).toEqual(['water'])
    expect(getScheduledUtilityBillTypes(new Date('2026-08-23T17:00:00Z'), schedule)).toEqual([])
  })
})

describe('Utility bill Flex Message', () => {
  test('builds independent MEA and MWA bill cards', () => {
    const electricity = buildUtilityBillFlexMessage({
      utility: 'electricity',
      period: 'กรกฎาคม 2569',
      amount: '1,169.52',
      usage: '277.0 kWh',
    })
    const water = buildUtilityBillFlexMessage({
      utility: 'water',
      period: 'กรกฎาคม 2569',
      amount: '202.60',
      usage: '19.0 m³',
    })

    expect(electricity.sender.iconUrl).toBe('https://home.ourkk.com/mea.png')
    expect(water.sender.iconUrl).toBe('https://home.ourkk.com/mwa.png')
    expect(electricity.sender.name).toBe('ค่าไฟ')
    expect(water.sender.name).toBe('ค่าน้ำ')
    expect(electricity.contents.size).toBe('mega')
    expect(water.contents.size).toBe('mega')
    expect(electricity.contents).not.toHaveProperty('header')
    expect(water.contents).not.toHaveProperty('header')
    expect(JSON.stringify([electricity, water])).not.toContain('มีบิล')
    expect(JSON.stringify([electricity, water])).not.toContain('EnergyLib')
  })
})
