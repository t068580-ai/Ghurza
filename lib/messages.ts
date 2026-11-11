import 'server-only'
import { db } from './db'
import { getOrderForParticipant } from './authz'

// Chat only exists on an Order, and an Order only exists after a verified upfront
// payment. So there is no way to message before money is committed. Every read and
// write re-runs the participant check.

export type ChatMessage = { id: number; body: string; createdAt: string; mine: boolean; senderName: string }

export async function listMessagesAfter(orderId: string, me: string, afterId: number, take = 100): Promise<ChatMessage[] | null> {
  const order = await getOrderForParticipant(orderId, me)
  if (!order) return null
  const rows = await db.message.findMany({
    where: { orderId: order.id, id: { gt: afterId } },
    orderBy: { id: 'asc' },
    take: Math.min(Math.max(take, 1), 100),
    select: { id: true, body: true, createdAt: true, senderId: true, sender: { select: { displayName: true } } },
  })
  return rows.map((m) => ({
    id: m.id,
    body: m.body,
    createdAt: m.createdAt.toISOString(),
    mine: m.senderId === me,
    senderName: m.sender.displayName,
  }))
}

export async function sendMessage(orderId: string, me: string, body: string): Promise<boolean> {
  const order = await getOrderForParticipant(orderId, me)
  if (!order) return false
  await db.message.create({ data: { orderId: order.id, senderId: me, body } })
  return true
}
