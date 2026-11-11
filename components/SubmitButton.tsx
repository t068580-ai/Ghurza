'use client'

import { useFormStatus } from 'react-dom'
import type { ReactNode } from 'react'

export function SubmitButton({
  children,
  pendingText = 'Working…',
  variant,
  block,
}: {
  children: ReactNode
  pendingText?: string
  variant?: 'secondary' | 'danger' | 'link'
  block?: boolean
}) {
  const { pending } = useFormStatus()
  const cls = ['btn', variant, block ? 'block' : ''].filter(Boolean).join(' ')
  return (
    <button type="submit" className={cls} disabled={pending} aria-busy={pending}>
      {pending ? pendingText : children}
    </button>
  )
}
