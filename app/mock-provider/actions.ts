'use server'

import { redirect } from 'next/navigation'
import { requireActionUser } from '@/lib/auth'
import { mockProviderDecide } from '@/lib/payments/mock-provider'
import { mockPaySchema, parseForm } from '@/lib/validation'
import { fail, NOT_ALLOWED, NOT_FOUND, type ActionState } from '@/lib/action-result'

// The "provider" deciding. It never writes Payment or Order rows itself: it signs an
// event and hands it to receiveProviderCallback(), exactly like a real webhook.
export async function mockProviderSubmitAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requireActionUser('CUSTOMER')
  if (!me) return NOT_ALLOWED
  const parsed = parseForm(mockPaySchema, fd)
  if (!parsed.ok) return NOT_FOUND
  const ok = await mockProviderDecide(parsed.data.paymentId, me.id, parsed.data.outcome)
  if (!ok) return fail('This checkout has expired or was replaced. Go back and try again.')
  redirect(`/payments/${parsed.data.paymentId}`)
}
