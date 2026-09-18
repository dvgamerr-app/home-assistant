import { io, type Socket } from 'socket.io-client'
import { requestConnectivityProbe, startConnectivity, subscribeConnectivity } from './connectivity'
import type { SocketChannel } from './socket'

/**
 * socket.io ที่ "ต่อเมื่อออนไลน์ · ตัดเมื่อออฟไลน์"
 *
 * ปล่อยให้ socket.io reconnect เองตอนเน็ตล่มจะยิงรัวไม่หยุดและกินแบตมือถือ อีกทั้ง
 * หน้าเว็บก็จะเดาไม่ออกว่าข้อมูลที่เห็นอยู่สดหรือค้าง — จึงตัดการเชื่อมต่อทิ้งไปเลย
 * แล้วค่อยต่อกลับเมื่อ `connectivity` ยืนยันว่าเซิร์ฟเวอร์ตอบแล้ว
 */
export type LiveSocket = {
  socket: Socket
  dispose: () => void
}

export function createLiveSocket(url: string, channels: SocketChannel[], bind: (socket: Socket) => void): LiveSocket {
  startConnectivity()

  const socket = io(url, {
    transports: ['websocket'],
    autoConnect: false,
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10_000,
  })

  socket.on('connect', () => socket.emit('subscribe', channels))
  // socket ต่อไม่ติดอาจเป็นเพราะเน็ตล่ม — ให้ probe ตรวจทันทีแทนที่จะรอรอบถัดไป
  socket.on('connect_error', () => requestConnectivityProbe())
  bind(socket)

  const unsubscribe = subscribeConnectivity((state) => {
    if (!state.settled) return
    if (state.online) {
      // `active` = ต่ออยู่หรือกำลังไล่ reconnect — ไม่ต้องสั่งซ้ำ
      if (!socket.active) socket.connect()
    } else if (socket.active) {
      socket.disconnect()
    }
  })

  return {
    socket,
    dispose: () => {
      unsubscribe()
      socket.removeAllListeners()
      socket.disconnect()
    },
  }
}
