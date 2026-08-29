import { describe, expect, test } from 'bun:test'
import { shouldNotifyBill } from './utility-bill-alerts'
import { buildUtilityBillFlexMessage } from './utility-line-notice'

describe('Utility bill dedupe', () => {
  test('แจ้งเมื่อเลขบิลเปลี่ยน ไม่ว่าจะเป็นวันที่เท่าไร', () => {
    expect(shouldNotifyBill({ lastValue: '900001' }, '900002')).toBe('notify')
  })

  test('เลขบิลเดิม = ไม่แจ้งซ้ำ (เรียกกี่รอบก็ปลอดภัย)', () => {
    expect(shouldNotifyBill({ lastValue: '900002' }, '900002')).toBe('none')
  })

  test('ครั้งแรกสุดแค่จดไว้ ไม่แจ้ง กันสแปมตอนตั้งระบบใหม่', () => {
    expect(shouldNotifyBill(null, '900002')).toBe('record-only')
  })

  test('lastValue ว่างแต่มีบิลอยู่ = ถือว่าบิลใหม่', () => {
    expect(shouldNotifyBill({ lastValue: null }, '900002')).toBe('notify')
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
