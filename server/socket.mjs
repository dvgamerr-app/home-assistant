import { createServer } from 'http'
import { Server } from 'socket.io'
import { logger } from '../src/lib/logger.ts'
import { getLiveSnapshot } from '../src/lib/db.ts'
import { getTodayFiveMinChartPayload } from '../src/lib/solar-fivemin.ts'
import { SOCKET_CHANNELS, isSocketChannel, normalizeSocketChannels } from '../src/lib/socket.ts'

const PORT = parseInt(process.env.SOCKET_PORT ?? '3000')
const POLL_MS = 60_000

const httpServer = createServer()
const io = new Server(httpServer, {
  cors: { origin: process.env.APP_BASE_URL ?? '*' },
})

async function broadcast() {
  try {
    const channels = [...io.sockets.adapter.rooms.keys()].filter((room) => isSocketChannel(room) && io.sockets.adapter.rooms.get(room)?.size)
    await Promise.all(channels.map(async (channel) => emitChannel(io.to(channel), channel)))
    logger.debug({ channels, clients: io.engine.clientsCount }, 'broadcast socket channels')
  } catch (err) {
    logger.error({ err }, 'broadcast error')
  }
}

async function getChannelPayload(channel) {
  switch (channel) {
    case SOCKET_CHANNELS.live:
      return getLiveSnapshot()
    case SOCKET_CHANNELS.solarFiveMin:
      return getTodayFiveMinChartPayload()
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

await broadcast()
setInterval(broadcast, POLL_MS)

httpServer.listen(PORT, () => logger.info(`socket.io server port:${PORT} started`))
