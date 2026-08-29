// @ts-check
import { createServer } from 'http'
import { Server } from 'socket.io'
import { config } from '../src/lib/config.ts'
import { logger } from '../src/lib/logger.ts'
import { getLiveSnapshot } from '../src/lib/db.ts'
import { cacheData } from '../src/lib/data-cache.ts'
import { getBangkokISODate } from '../src/lib/date.ts'
import { getTodayFiveMinChartPayload } from '../src/lib/solar-fivemin.ts'
import { SOCKET_CHANNELS, isSocketChannel, normalizeSocketChannels } from '../src/lib/socket.ts'
import { runEnergyAlerts } from '../src/lib/energy-alerts.ts'
import { getScheduledUtilityBillTypes, runUtilityBillAlerts } from '../src/lib/utility-bill-alerts.ts'

const PORT = parseInt(process.env.SOCKET_PORT ?? '3000')
const { socketMs: SOCKET_POLL_MS, energyAlertMs: ENERGY_ALERT_POLL_MS, utilityAlertMs: UTILITY_ALERT_POLL_MS } = config.poll
const LIVE_CACHE_MS = 5_000

const httpServer = createServer()
const io = new Server(httpServer, {
  cors: { origin: process.env.APP_BASE_URL ?? '*' },
})

let broadcasting = false
let lastLiveSignature = ''
let lastChartSignature = ''

const getCachedLive = () => cacheData('socket:live', LIVE_CACHE_MS, getLiveSnapshot)

/** @param {Awaited<ReturnType<typeof getLiveSnapshot>> | undefined} [live] */
async function getChartPayload(live) {
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

/** @param {import('../src/lib/socket.ts').SocketChannel} channel */
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

/**
 * @param {{ emit: (channel: string, payload: unknown) => unknown }} target
 * @param {import('../src/lib/socket.ts').SocketChannel} channel
 */
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

// bind ล้มเหลว (เช่น EADDRINUSE) ต้องออกด้วย exit code ที่ไม่ใช่ 0
// ไม่งั้น process ค้างอยู่แบบไม่ฟัง port และ alert ทั้งหมดตายเงียบ
httpServer.on('error', (err) => {
  logger.fatal({ err, port: PORT }, 'socket server failed to start')
  process.exit(1)
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
const timers = [
  setInterval(() => void broadcast(), SOCKET_POLL_MS),
  setInterval(() => void runEnergyAlerts(), ENERGY_ALERT_POLL_MS),
  setInterval(() => void runScheduledUtilityBillAlerts(), UTILITY_ALERT_POLL_MS),
]

process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandled rejection'))
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'uncaught exception')
  process.exit(1)
})

let shuttingDown = false
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    if (shuttingDown) return
    shuttingDown = true
    logger.info({ signal }, 'shutting down socket server')
    for (const timer of timers) clearInterval(timer)
    io.close(() => process.exit(0))
    // เผื่อ client ค้าง ไม่ให้ deploy รอจน SIGKILL
    setTimeout(() => process.exit(0), 5_000).unref()
  })
}
