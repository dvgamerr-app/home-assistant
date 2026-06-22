import pino from 'pino'

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  ...(process.env.LOG_FORMAT === 'text' ? { transport: { target: 'pino-pretty', options: { colorize: true } } } : {}),
})
