import { createServer } from 'http'
import { Server } from 'socket.io'
import { logger } from '../src/lib/logger.ts'
import { getLiveSnapshot } from '../src/lib/db.ts'

const PORT = parseInt(process.env.SOCKET_PORT ?? '3000')
const POLL_MS = 60_000

const httpServer = createServer()
const io = new Server(httpServer, {
  cors: { origin: process.env.APP_BASE_URL ?? '*' },
})

async function broadcast() {
  try {
    const live = await getLiveSnapshot()
    io.emit('live', live)
    logger.debug({ clients: io.engine.clientsCount }, 'broadcast live')
  } catch (err) {
    logger.error({ err }, 'broadcast error')
  }
}

io.on('connection', async (socket) => {
  logger.info({ id: socket.id }, 'client connected')
  try {
    const live = await getLiveSnapshot()
    socket.emit('live', live)
  } catch (err) {
    logger.error({ err }, 'initial snapshot error')
  }
  socket.on('disconnect', () => logger.info({ id: socket.id }, 'client disconnected'))
})

await broadcast()
setInterval(broadcast, POLL_MS)

httpServer.listen(PORT, () => logger.info({ port: PORT }, 'socket.io server started'))
