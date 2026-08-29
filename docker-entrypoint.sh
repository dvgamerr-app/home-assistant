#!/bin/sh
# รัน 2 process ในคอนเทนเนอร์เดียว: socket.io server (alert worker) + Astro server
#
# เดิม CMD เป็น `sh -c "... & exec ..."` ซึ่งมีปัญหา 2 อย่าง:
#   1. sh ไม่ forward SIGTERM ให้ background job → ตอน deploy socket process
#      ถูก SIGKILL กลางรอบ alert (handler ใน server/socket.mjs ไม่มีโอกาสทำงาน)
#   2. ถ้า socket process ตาย คอนเทนเนอร์ยังดู healthy เพราะ PID 1 เป็น Astro
#      → alert ทั้งหมดหยุดเงียบๆ
#
# หมายเหตุ: เขียนแบบ POSIX sh ล้วน (image เป็น debian slim → /bin/sh คือ dash
# ซึ่งไม่มี `wait -n`) จึงเฝ้าลูกด้วย `kill -0` แทน
set -e

bun run migration:run

SOCKET_PID=''
WEB_PID=''

stop_children() {
  [ -n "$SOCKET_PID" ] && kill -TERM "$SOCKET_PID" 2>/dev/null || true
  [ -n "$WEB_PID" ] && kill -TERM "$WEB_PID" 2>/dev/null || true
}

on_signal() {
  echo "entrypoint: received signal, stopping children"
  stop_children
  wait
  exit 0
}
trap on_signal TERM INT

bun server/socket.mjs &
SOCKET_PID=$!

bun ./dist/server/entry.mjs &
WEB_PID=$!

echo "entrypoint: socket pid=$SOCKET_PID web pid=$WEB_PID"

# ตัวไหนตายก่อนก็ให้คอนเทนเนอร์ตายตาม เพื่อให้ restart policy ทำงาน
while kill -0 "$SOCKET_PID" 2>/dev/null && kill -0 "$WEB_PID" 2>/dev/null; do
  sleep 1
done

echo "entrypoint: a child exited, shutting down the container"
stop_children
wait 2>/dev/null || true
exit 1
