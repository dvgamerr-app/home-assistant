import { describe, expect, test } from 'bun:test'
import { buildUtilityBillFlexMessage, buildUtilityBillNoticeRequest } from './utility-line-notice'

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
    expect(JSON.stringify([electricity, water])).not.toContain('Energy Lib')
  })

  test('wraps a utility bill Flex object in the messages array', () => {
    const request = buildUtilityBillNoticeRequest({
      utility: 'electricity',
      period: 'กรกฎาคม 2569',
      amount: '1,169.52',
      usage: '277.0 kWh',
    })

    expect(request.messages).toHaveLength(1)
    expect(request.messages[0].type).toBe('flex')
    expect(request).not.toHaveProperty('message')
  })
})
