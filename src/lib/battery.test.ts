import { describe, expect, test } from 'bun:test'
import { getBatteryConnectionState } from './battery'
import type { LiveSnapshot } from './db'

const live = (overrides: Partial<LiveSnapshot> = {}): LiveSnapshot => ({
  activeAlarms: [],
  batteryCurrent: 0,
  batteryPowerKw: 0,
  batterySoc: 100,
  batterySoh: 99,
  batteryStatus: 'Idle',
  batteryVoltage: 52,
  cyclePeriod: 80,
  firmwareVersion: null,
  gridFrequencyHz: 50,
  gridPowerKw: 0,
  gridVoltage: 230,
  isOnline: true,
  lastUpdate: new Date().toISOString(),
  loadPowerKw: 1,
  offGridPowerKw: 0,
  powerRating: 8,
  pv1: { current: 0, power: 0, voltage: 0 },
  pv2: { current: 0, power: 0, voltage: 0 },
  pvPowerKw: 0,
  serialNumber: null,
  totalGenerationTime: 0,
  ...overrides,
})

describe('getBatteryConnectionState', () => {
  test('does not treat Idle as connected when voltage is below the installation threshold', () => {
    expect(getBatteryConnectionState(live({ batteryVoltage: 15 }), 20)).toBe('disconnected')
  })

  test('treats an active batteryNoConnected alarm as disconnected', () => {
    expect(
      getBatteryConnectionState(
        live({
          activeAlarms: [{ description: null, firedAt: new Date().toISOString(), firedValue: '1', key: 'batteryNoConnected', level: 2, name: 'Battery No Connected' }],
        }),
        20,
      ),
    ).toBe('disconnected')
  })

  test('recognizes battery activity as connected even when a voltage source is scaled unexpectedly', () => {
    expect(getBatteryConnectionState(live({ batteryPowerKw: -1.2, batteryStatus: 'Charging', batteryVoltage: 15 }), 20)).toBe('connected')
  })

  test('returns unknown while inverter data is offline', () => {
    expect(getBatteryConnectionState(live({ isOnline: false }), 20)).toBe('unknown')
  })
})
