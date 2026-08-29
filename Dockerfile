# pin ให้ตรงกับ bun ที่สร้าง bun.lock (packageManager ใน package.json)
# `latest` ทำให้ build ไม่ reproducible และ lockfile อาจไม่ตรงเวอร์ชัน
FROM oven/bun:1.4.0 AS builder
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM oven/bun:1.4.0-slim
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server ./server
COPY --from=builder /app/src ./src
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production --ignore-scripts
ENV HOST=0.0.0.0 PORT=4321
EXPOSE 4321
COPY docker-entrypoint.sh ./
CMD ["sh", "./docker-entrypoint.sh"]
