import { betterAuth } from 'better-auth'
import { kyselyAdapter } from '@better-auth/kysely-adapter'
import { getAuthDb } from '../db/auth-db'

const githubId = process.env.GITHUB_CLIENT_ID
const githubSecret = process.env.GITHUB_CLIENT_SECRET

export const auth = betterAuth({
  database: kyselyAdapter(getAuthDb(), { type: 'postgres' }),
  secret: process.env.BETTER_AUTH_SECRET!,
  baseURL: process.env.APP_BASE_URL ?? 'http://localhost:4321',
  basePath: '/api/auth',
  onAPIError: {
    errorURL: new URL('/login', process.env.APP_BASE_URL ?? 'http://localhost:4321').toString(),
  },
  emailAndPassword: { enabled: true },
  ...(githubId && githubSecret
    ? {
        socialProviders: {
          github: { clientId: githubId, clientSecret: githubSecret },
        },
        account: {
          accountLinking: { enabled: true, trustedProviders: ['github'] as const },
        },
      }
    : {}),
})

export type Session = typeof auth.$Infer.Session
export type User = typeof auth.$Infer.Session.user
