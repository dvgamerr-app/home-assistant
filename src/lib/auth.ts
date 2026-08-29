import { betterAuth } from 'better-auth'
import { kyselyAdapter } from '@better-auth/kysely-adapter'
import { twoFactor } from 'better-auth/plugins'
import { getAuthDb } from '../db/auth-db'

const githubId = process.env.GITHUB_CLIENT_ID
const githubSecret = process.env.GITHUB_CLIENT_SECRET

export const auth = betterAuth({
  appName: 'OurKK',
  database: kyselyAdapter(getAuthDb(), { type: 'postgres' }),
  secret: process.env.BETTER_AUTH_SECRET!,
  baseURL: process.env.APP_BASE_URL ?? 'http://localhost:4321',
  basePath: '/api/auth',
  onAPIError: {
    errorURL: new URL('/login', process.env.APP_BASE_URL ?? 'http://localhost:4321').toString(),
  },
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
  },
  session: {
    // อยู่ได้ 7 วัน และต่ออายุอัตโนมัติเมื่อยังใช้งานอยู่ (rolling)
    // → ถ้าเข้าเว็บอย่างน้อยสัปดาห์ละครั้ง จะไม่ต้อง login ใหม่เลย
    expiresIn: 60 * 60 * 24 * 7,
    // session ที่เก่ากว่า 1 วันจะถูก refresh ตอนมี request เข้ามา
    updateAge: 60 * 60 * 24,
    // middleware เรียก getSession ทุก request — cache ใน cookie ที่ signed แล้ว
    // ช่วยตัด query ไป auth DB ทิ้งเกือบทั้งหมด
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60,
    },
  },
  plugins: [twoFactor({ issuer: 'OurKK' })],
  ...(githubId && githubSecret
    ? {
        socialProviders: {
          github: { clientId: githubId, clientSecret: githubSecret, disableSignUp: true },
        },
        account: {
          accountLinking: { enabled: true, trustedProviders: ['github'] as const },
        },
      }
    : {}),
})

export type Session = typeof auth.$Infer.Session
export type User = typeof auth.$Infer.Session.user
