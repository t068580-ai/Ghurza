import { NextResponse } from 'next/server'
import { receiveProviderCallback } from '@/lib/payments/callback'

export const dynamic = 'force-dynamic'

const MAX_BODY_BYTES = 2048
const noStore = { 'Cache-Control': 'no-store' }

// Reads at most `limit` bytes. Route handlers have no built-in body limit, so an
// anonymous caller could otherwise stream hundreds of MB into memory before the
// signature is even checked.
async function readCapped(req: Request, limit: number): Promise<string | null> {
  if (!req.body) return ''
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > limit) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}

// Public webhook a real payment provider would call. It ignores cookies and
// sessions entirely: the only thing that makes it act is a valid HMAC signature
// over the exact raw body, within 5 minutes. Try it with curl and a made-up
// signature: you get 401 and nothing changes.
export async function POST(req: Request) {
  const declared = Number(req.headers.get('content-length') ?? NaN)
  if (!Number.isFinite(declared)) return NextResponse.json({ error: 'length required' }, { status: 411, headers: noStore })
  if (declared > MAX_BODY_BYTES) return NextResponse.json({ error: 'body too large' }, { status: 413, headers: noStore })

  // Content-Length can lie, so the stream is capped as well.
  const rawBody = await readCapped(req, MAX_BODY_BYTES)
  if (rawBody === null) return NextResponse.json({ error: 'body too large' }, { status: 413, headers: noStore })

  const res = await receiveProviderCallback(rawBody, {
    contentType: req.headers.get('content-type'),
    signature: req.headers.get('x-provider-signature'),
  })
  return NextResponse.json(res.body, { status: res.status, headers: noStore })
}
