'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatMessage } from '@/lib/messages'
import type { ActionState } from '@/lib/action-result'

// Live-ish chat by polling. Every poll goes through GET /api/orders/[id]/messages,
// which re-checks the session and that the viewer is a participant, so signing out
// cuts access within one poll. Messages are rendered as plain text (React escapes).
export function ChatBox({
  orderId,
  initial,
  send,
}: {
  orderId: string
  initial: ChatMessage[]
  send: (state: ActionState, fd: FormData) => Promise<ActionState>
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(initial)
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const lastId = useRef(initial.at(-1)?.id ?? 0)
  const listRef = useRef<HTMLDivElement>(null)
  const idle = useRef(0)

  const poll = useCallback(async () => {
    try {
      const res = await fetch(`/api/orders/${orderId}/messages?after=${lastId.current}`, { cache: 'no-store' })
      if (!res.ok) return
      const data = (await res.json()) as { messages: ChatMessage[] }
      if (data.messages.length) {
        idle.current = 0
        lastId.current = data.messages[data.messages.length - 1].id
        setMessages((m) => [...m, ...data.messages.filter((x) => !m.some((y) => y.id === x.id))])
      } else {
        idle.current++
      }
    } catch {
      // network blip: try again next tick
    }
  }, [orderId])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const tick = async () => {
      if (!document.hidden) await poll()
      // 3 s while active, backing off to 15 s when nothing new arrives.
      const delay = idle.current > 10 ? 15000 : 3000
      timer = setTimeout(tick, delay)
    }
    timer = setTimeout(tick, 3000)
    return () => clearTimeout(timer)
  }, [poll])

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [messages.length])

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    setSending(true)
    setError(null)
    const res = await send(null, new FormData(form))
    setSending(false)
    if (res?.ok) {
      form.reset()
      idle.current = 0
      await poll()
    } else {
      setError(res?.error ?? 'Could not send.')
    }
  }

  return (
    <div>
      <div className="chat" ref={listRef} aria-live="polite">
        {messages.length === 0 && <p className="muted small">No messages yet. Say hello and arrange measurements.</p>}
        {messages.map((m) => (
          <div key={m.id} className={`msg ${m.mine ? 'mine' : ''}`}>
            <div className="msg-meta">
              {m.mine ? 'You' : m.senderName} · {new Date(m.createdAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
            </div>
            <div className="msg-body">{m.body}</div>
          </div>
        ))}
      </div>
      <form onSubmit={onSubmit} style={{ marginTop: 10 }}>
        {error && (
          <div className="notice bad" role="alert">
            {error}
          </div>
        )}
        <input type="hidden" name="orderId" value={orderId} />
        <label htmlFor="body" className="hint">
          Message
        </label>
        <textarea id="body" name="body" required maxLength={2000} style={{ minHeight: 70 }} />
        <div className="row" style={{ marginTop: 8, justifyContent: 'flex-end' }}>
          <button type="submit" className="btn" disabled={sending}>
            {sending ? 'Sending…' : 'Send'}
          </button>
        </div>
      </form>
    </div>
  )
}
