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

// ponytail: dev has no reverse proxy in front of astro, so hit the socket server directly instead of relying on same-origin routing
export function getSocketUrl(requestUrl: string) {
  if (import.meta.env.DEV) return `http://localhost:${process.env.SOCKET_PORT ?? 3000}`

  const base = new URL(process.env.APP_BASE_URL ?? requestUrl)
  const wsProtocol = base.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${wsProtocol}//${base.host}`
}
