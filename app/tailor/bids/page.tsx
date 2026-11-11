import Link from 'next/link'
import { requireRole } from '@/lib/auth'
import { listBidsForTailor } from '@/lib/bids'
import { formatKWD } from '@/lib/money'
import { Money, PieceTag, StatusBadge } from '@/components/ui'

export default async function TailorBidsPage() {
  const me = await requireRole('TAILOR')
  const bids = await listBidsForTailor(me.id)
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Your work</div>
          <h1>My bids</h1>
        </div>
      </div>
      <div className="card">
        {bids.length === 0 ? (
          <div className="empty">
            You haven&apos;t bid yet. <Link href="/tailor/requests">Browse open requests</Link>
          </div>
        ) : (
          bids.map((b) => (
            <Link key={b.id} href={b.order ? `/orders/${b.order.id}` : `/tailor/requests/${b.request.id}`} className="item">
              <div style={{ flex: 1 }}>
                <div className="row" style={{ gap: 8 }}>
                  <PieceTag type={b.request.pieceType} />
                  <StatusBadge status={b.status} />
                  {b.version > 1 && <span className="badge">v{b.version}</span>}
                </div>
                <div className="item-title" style={{ marginTop: 4 }}>
                  {b.request.title}
                </div>
                <div className="muted small">
                  {formatKWD(b.upfrontFils)} upfront · {formatKWD(b.completionFils)} on completion · {b.turnaroundDays} days
                </div>
              </div>
              <div style={{ textAlign: 'right', fontWeight: 700 }}>
                <Money fils={b.totalFils} />
              </div>
            </Link>
          ))
        )}
      </div>
    </>
  )
}
