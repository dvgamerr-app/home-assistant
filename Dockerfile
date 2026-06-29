FROM oven/bun:latest AS builder
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM oven/bun:slim
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server ./server
COPY --from=builder /app/src ./src
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production --ignore-scripts
ENV HOST=0.0.0.0 PORT=4321
EXPOSE 4321
CMD ["sh", "-c", "bun server/socket.mjs & bun ./dist/server/entry.mjs"]
