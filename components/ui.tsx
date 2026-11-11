import { formatKWD } from '@/lib/money'
import { pieceLabel } from '@/lib/enums'

export function Money({ fils }: { fils: number }) {
  return <span className="money">{formatKWD(fils)}</span>
}

export function Budget({ min, max }: { min: number | null; max: number | null }) {
  if (min == null && max == null) return <span className="muted">No budget given</span>
  if (min != null && max != null) {
    return (
      <span>
        Budget <Money fils={min} /> – <Money fils={max} />
      </span>
    )
  }
  return (
    <span>
      Budget {min != null ? 'from ' : 'up to '}
      <Money fils={(min ?? max) as number} />
    </span>
  )
}

const TONES: Record<string, string> = {
  OPEN: 'info',
  AWARDED: 'ok',
  CANCELLED: '',
  PENDING: 'warn',
  DECLINED: 'bad',
  ACCEPTED: 'ok',
  LOST: '',
  IN_PROGRESS: 'info',
  READY: 'warn',
  COMPLETED: 'ok',
  PAID: 'ok',
  FAILED: 'bad',
  REFUND_DUE: 'bad',
}

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return <span className={`badge ${TONES[status] ?? ''}`}>{label ?? status.replace('_', ' ').toLowerCase()}</span>
}

export function PieceTag({ type }: { type: string }) {
  return <span className="badge">{pieceLabel(type)}</span>
}

export function Stars({ value }: { value: number }) {
  const full = Math.round(value)
  return (
    <span className="stars" aria-label={`${value.toFixed(1)} out of 5`}>
      {'★'.repeat(full)}
      <span className="muted">{'★'.repeat(5 - full)}</span>
    </span>
  )
}

export function formatDate(d: Date | string | null | undefined): string {
  if (!d) return ''
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function formatDateTime(d: Date | string): string {
  return new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}
