export const SOCKET_CHANNELS = {
  live: 'live',
  solarFiveMin: 'solar:fivemin',
} as const

export type SocketChannel = (typeof SOCKET_CHANNELS)[keyof typeof SOCKET_CHANNELS]

const SOCKET_CHANNEL_SET = new Set<SocketChannel>(Object.values(SOCKET_CHANNELS))

export function isSocketChannel(value: string): value is SocketChannel {
  return SOCKET_CHANNEL_SET.has(value as SocketChannel)
}

export function normalizeSocketChannels(value: SocketChannel | SocketChannel[] | unknown): SocketChannel[] {
  const raw = Array.isArray(value) ? value : [value]
  return raw.filter((channel): channel is SocketChannel => typeof channel === 'string' && isSocketChannel(channel))
}
