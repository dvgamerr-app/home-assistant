import type { LiveSnapshot } from './db'

export type BatteryConnectionState = 'connected' | 'disconnected' | 'unknown'

type BatteryConnectionInput = Pick<LiveSnapshot, 'activeAlarms' | 'batteryCurrent' | 'batteryPowerKw' | 'batteryStatus' | 'batteryVoltage' | 'isOnline'>

const DISCONNECTED_STATUS = new Set(['disconnected', 'notconnected', 'batterynotconnected', 'batterynoconnected'])
const CONNECTED_STATUS = new Set(['charging', 'discharging'])

const normalizeStatus = (value: string | null) => value?.toLowerCase().replace(/[\s_-]/g, '') ?? ''

/**
 * `Idle` only describes power flow and must not be treated as proof that a battery is connected.
 * This installation exposes a low standby voltage when its battery is disconnected, so voltage is
 * used after explicit alarms/activity and the threshold remains a system-level setting.
 */
export function getBatteryConnectionState(live: BatteryConnectionInput, minimumConnectedVoltage: number): BatteryConnectionState {
  const status = normalizeStatus(live.batteryStatus)
  const hasDisconnectedAlarm = live.activeAlarms.some((alarm) => normalizeStatus(alarm.key) === 'batterynoconnected')

  if (hasDisconnectedAlarm || DISCONNECTED_STATUS.has(status)) return 'disconnected'
  if (!live.isOnline) return 'unknown'

  const hasBatteryActivity = Math.abs(live.batteryPowerKw) > 0.05 || Math.abs(live.batteryCurrent) > 0.05
  if (hasBatteryActivity || CONNECTED_STATUS.has(status)) return 'connected'

  if (!Number.isFinite(live.batteryVoltage)) return 'unknown'
  return live.batteryVoltage >= minimumConnectedVoltage ? 'connected' : 'disconnected'
}
