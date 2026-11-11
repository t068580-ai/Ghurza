import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { listMessagesAfter } from '@/lib/messages'
import { consume } from '@/lib/rate-limit'
import { idSchema } from '@/lib/validation'

export const dynamic = 'force-dynamic'

const noStore = { 'Cache-Control': 'no-store' }

// GET only, never mutates. No CORS headers, so other sites can't read it.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: noStore })

  const { id } = await ctx.params
  if (!idSchema.safeParse(id).success) return NextResponse.json({ error: 'not found' }, { status: 404, headers: noStore })

  const afterRaw = new URL(req.url).searchParams.get('after') ?? '0'
  const after = /^\d{1,10}$/.test(afterRaw) ? Number(afterRaw) : 0

  if (!(await consume(`poll:${user.id}`, 120, 60 * 1000))) {
    return NextResponse.json({ error: 'slow down' }, { status: 429, headers: noStore })
  }

  // Non-participants get the same 404 as a non-existent order.
  const messages = await listMessagesAfter(id, user.id, after)
  if (!messages) return NextResponse.json({ error: 'not found' }, { status: 404, headers: noStore })
  return NextResponse.json({ messages }, { headers: noStore })
}
