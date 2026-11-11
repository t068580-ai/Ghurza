import Link from 'next/link'
import { requireRole } from '@/lib/auth'
import { listOpenRequestsForTailor } from '@/lib/bids'
import { fileUrl } from '@/lib/uploads'
import { Budget, PieceTag, StatusBadge, formatDate } from '@/components/ui'

export default async function TailorRequestsPage() {
  const me = await requireRole('TAILOR')
  const requests = await listOpenRequestsForTailor(me.id)

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Open commissions</div>
          <h1>Open requests</h1>
          <p className="lede">Bids are blind: you&apos;ll see how many tailors bid and the lowest figure, never who they are or what each quoted.</p>
        </div>
      </div>
      <div className="card">
        {requests.length === 0 ? (
          <div className="empty">No open requests right now.</div>
        ) : (
          requests.map((r) => {
            const photo = fileUrl(r.photoId)
            return (
              <Link key={r.id} href={`/tailor/requests/${r.id}`} className="item">
                {photo ? <img className="thumb" src={photo} alt="" /> : <div className="thumb" aria-hidden />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="row" style={{ gap: 8 }}>
                    <PieceTag type={r.pieceType} />
                    {r.myBidStatus && <StatusBadge status={r.myBidStatus} label={`your bid: ${r.myBidStatus.toLowerCase()}`} />}
                  </div>
                  <div className="item-title" style={{ marginTop: 4 }}>
                    {r.title}
                  </div>
                  <div className="muted small clamp">{r.description}</div>
                  <div className="small" style={{ marginTop: 4 }}>
                    <Budget min={r.budgetMinFils} max={r.budgetMaxFils} />
                    {r.neededBy && <span className="muted"> · needed by {formatDate(r.neededBy)}</span>}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="stat-value">{r.bidCount}</div>
                  <div className="muted small">{r.bidCount === 1 ? 'bid' : 'bids'}</div>
                </div>
              </Link>
            )
          })
        )}
      </div>
    </>
  )
}
