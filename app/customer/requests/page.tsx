import Link from 'next/link'
import { requireRole } from '@/lib/auth'
import { listRequestsForCustomer } from '@/lib/requests'
import { fileUrl } from '@/lib/uploads'
import { Budget, PieceTag, StatusBadge } from '@/components/ui'

export default async function CustomerRequestsPage() {
  const me = await requireRole('CUSTOMER')
  const requests = await listRequestsForCustomer(me.id)

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Your pieces</div>
          <h1>My requests</h1>
        </div>
        <Link className="btn" href="/customer/requests/new">
          Post a request
        </Link>
      </div>
      <div className="card">
        {requests.length === 0 ? (
          <div className="empty">
            <p>You haven&apos;t posted anything yet.</p>
            <Link className="btn" href="/customer/requests/new">
              Describe your first piece
            </Link>
          </div>
        ) : (
          requests.map((r) => {
            const live = r.bids.filter((b) => b.status === 'PENDING').length
            const photo = fileUrl(r.referencePhotoId)
            return (
              <Link key={r.id} href={`/customer/requests/${r.id}`} className="item">
                {photo ? <img className="thumb" src={photo} alt="" /> : <div className="thumb" aria-hidden />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="row" style={{ gap: 8 }}>
                    <PieceTag type={r.pieceType} />
                    <StatusBadge status={r.status} />
                    {r.order && <StatusBadge status={r.order.status} label={`order: ${r.order.status.replace('_', ' ').toLowerCase()}`} />}
                  </div>
                  <div className="item-title" style={{ marginTop: 4 }}>
                    {r.title}
                  </div>
                  <div className="muted small clamp">{r.description}</div>
                  <div className="small" style={{ marginTop: 4 }}>
                    <Budget min={r.budgetMinFils} max={r.budgetMaxFils} />
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="stat-value">{r.bids.length}</div>
                  <div className="muted small">
                    {r.bids.length === 1 ? 'bid' : 'bids'}
                    {r.status === 'OPEN' && r.bids.length > 0 ? ` · ${live} pending` : ''}
                  </div>
                </div>
              </Link>
            )
          })
        )}
      </div>
    </>
  )
}
