import { createServer } from 'http'
import { Server } from 'socket.io'
import { logger } from '../src/lib/logger.ts'
import { getLiveSnapshot } from '../src/lib/db.ts'
import { cacheData } from '../src/lib/data-cache.ts'
import { getBangkokISODate } from '../src/lib/date.ts'
import { getTodayFiveMinChartPayload } from '../src/lib/solar-fivemin.ts'
import { SOCKET_CHANNELS, isSocketChannel, normalizeSocketChannels } from '../src/lib/socket.ts'
import { runEnergyAlerts } from '../src/lib/energy-alerts.ts'
import { getScheduledUtilityBillTypes, runUtilityBillAlerts } from '../src/lib/utility-bill-alerts.ts'

const PORT = parseInt(process.env.SOCKET_PORT ?? '3000')
const intervalEnv = (name, fallback, minimum) => {
  const value = Number(process.env[name])
  return Number.isFinite(value) ? Math.max(value, minimum) : fallback
}
const SOCKET_POLL_MS = intervalEnv('SOCKET_POLL_MS', 60_000, 10_000)
const ENERGY_ALERT_POLL_MS = intervalEnv('ENERGY_ALERT_POLL_MS', 5 * 60_000, 60_000)
const UTILITY_ALERT_POLL_MS = intervalEnv('UTILITY_ALERT_POLL_MS', 60 * 60_000, 5 * 60_000)
const LIVE_CACHE_MS = 5_000

const httpServer = createServer()
const io = new Server(httpServer, {
  cors: { origin: process.env.APP_BASE_URL ?? '*' },
})

let broadcasting = false
let lastLiveSignature = ''
let lastChartSignature = ''

const getCachedLive = () => cacheData('socket:live', LIVE_CACHE_MS, getLiveSnapshot)

async function getChartPayload(live = undefined) {
  const snapshot = live ?? (await getCachedLive())
  const signature = `${getBangkokISODate()}:${snapshot.lastUpdate}`
  return {
    signature,
    payload: await cacheData(`socket:five-min:${signature}`, 10 * 60_000, getTodayFiveMinChartPayload),
  }
}

async function broadcast() {
  if (broadcasting) return
  broadcasting = true

  try {
    const channels = [...io.sockets.adapter.rooms.keys()].filter((room) => isSocketChannel(room) && io.sockets.adapter.rooms.get(room)?.size)
    if (channels.length === 0) return

    const live = await getCachedLive()
    const emitted = []

    if (channels.includes(SOCKET_CHANNELS.live)) {
      const signature = `${live.lastUpdate}:${live.isOnline}`
      if (signature !== lastLiveSignature) {
        io.to(SOCKET_CHANNELS.live).emit(SOCKET_CHANNELS.live, live)
        lastLiveSignature = signature
        emitted.push(SOCKET_CHANNELS.live)
      }
    }

    if (channels.includes(SOCKET_CHANNELS.solarFiveMin)) {
      const chart = await getChartPayload(live)
      if (chart.signature !== lastChartSignature) {
        io.to(SOCKET_CHANNELS.solarFiveMin).emit(SOCKET_CHANNELS.solarFiveMin, chart.payload)
        lastChartSignature = chart.signature
        emitted.push(SOCKET_CHANNELS.solarFiveMin)
      }
    }

    logger.debug({ channels, emitted, clients: io.engine.clientsCount }, 'broadcast socket channels')
  } catch (err) {
    logger.error({ err }, 'broadcast error')
  } finally {
    broadcasting = false
  }
}

async function getChannelPayload(channel) {
  switch (channel) {
    case SOCKET_CHANNELS.live:
      return getCachedLive()
    case SOCKET_CHANNELS.solarFiveMin: {
      const chart = await getChartPayload()
      return chart.payload
    }
    default:
      return null
  }
}

async function emitChannel(target, channel) {
  const payload = await getChannelPayload(channel)
  if (payload) target.emit(channel, payload)
}

io.on('connection', (socket) => {
  logger.info(`client: ${socket.id} connected`)

  socket.on('subscribe', async (value) => {
    const channels = normalizeSocketChannels(value)
    if (channels.length === 0) return

    try {
      await Promise.all(
        channels.map(async (channel) => {
          await socket.join(channel)
          await emitChannel(socket, channel)
        }),
      )
      logger.debug({ id: socket.id, channels }, 'client subscribed')
    } catch (err) {
      logger.error({ err, id: socket.id, channels }, 'subscribe error')
    }
  })

  socket.on('unsubscribe', async (value) => {
    const channels = normalizeSocketChannels(value)
    if (channels.length === 0) return

    try {
      await Promise.all(channels.map((channel) => socket.leave(channel)))
      logger.debug({ id: socket.id, channels }, 'client unsubscribed')
    } catch (err) {
      logger.error({ err, id: socket.id, channels }, 'unsubscribe error')
    }
  })

  socket.on('disconnect', () => logger.info(`client: ${socket.id}, disconnected`))
})

httpServer.listen(PORT, () => logger.info(`socket.io server port:${PORT} started`))

const runScheduledUtilityBillAlerts = () => {
  const types = getScheduledUtilityBillTypes()
  if (types.length > 0) return runUtilityBillAlerts(types)
}

void broadcast()
void runEnergyAlerts()
// Startup check catches bills collected while this process was offline.
void runUtilityBillAlerts()
setInterval(() => void broadcast(), SOCKET_POLL_MS)
setInterval(() => void runEnergyAlerts(), ENERGY_ALERT_POLL_MS)
setInterval(() => void runScheduledUtilityBillAlerts(), UTILITY_ALERT_POLL_MS)
