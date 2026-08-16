const truncate = (value: string, max: number) => (value.length > max ? `${value.slice(0, Math.max(0, max - 1))}…` : value)

export async function sendLineMessages(messages: unknown[]) {
  const url = process.env.LINE_NOTICE_URL?.trim()
  const apiKey = process.env.LINE_NOTICE_API_KEY?.trim()
  if (!url || !apiKey) throw new Error('LINE notice endpoint is not configured')

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'X-API-Key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ messages }),
    signal: AbortSignal.timeout(15_000),
  })

  if (!response.ok) {
    const responseText = truncate(await response.text(), 500)
    throw new Error(`LINE notice request failed (${response.status}): ${responseText}`)
  }
}
