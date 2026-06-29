import type { APIRoute } from 'astro'
import { auth } from '@/lib/auth'

export const ALL: APIRoute = async ({ request }) => {
  const { pathname } = new URL(request.url)

  if (pathname === '/api/auth/sign-out') {
    const response = await auth.api.signOut({
      headers: request.headers,
      asResponse: true,
    })

    const headers = new Headers(response.headers)
    headers.set('location', '/login')
    headers.delete('content-length')

    return new Response(null, {
      status: 302,
      headers,
    })
  }

  return auth.handler(request)
}
