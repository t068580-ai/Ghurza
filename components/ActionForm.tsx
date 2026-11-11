'use client'

import { useActionState, type ReactNode } from 'react'
import type { ActionState } from '@/lib/action-result'

// A <form> bound to a Server Action that shows the action's error/success message.
// The action decides everything; this component only displays what it returns.
export function ActionForm({
  action,
  children,
  className,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>
  children: ReactNode
  className?: string
}) {
  const [state, formAction] = useActionState(action, null)
  return (
    <form action={formAction} className={className}>
      {state?.error && (
        <div className="notice bad" role="alert">
          {state.error}
        </div>
      )}
      {state?.ok && state.message && (
        <div className="notice ok" role="status">
          {state.message}
        </div>
      )}
      {children}
    </form>
  )
}
