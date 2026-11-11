import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth'
import { getRequestForCustomer } from '@/lib/bids'
import { fileUrl } from '@/lib/uploads'
import { formatKWD } from '@/lib/money'
import { cancelRequestAction, declineBidAction, startUpfrontPaymentAction } from '@/app/customer/actions'
import { ActionForm } from '@/components/ActionForm'
import { SubmitButton } from '@/components/SubmitButton'
import { Budget, Money, PieceTag, StatusBadge, formatDate, formatDateTime } from '@/components/ui'

export default async function CustomerRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireRole('CUSTOMER')
  const { id } = await params
  // Ownership is part of the query: someone else's request id is a 404.
  const req = await getRequestForCustomer(id, me.id)
  if (!req) notFound()
  const photo = fileUrl(req.referencePhotoId)
  const open = req.status === 'OPEN'

  return (
    <>
      <p className="small">
        <Link href="/customer/requests">← My requests</Link>
      </p>
      <div className="grid-2">
        <div className="card">
          <div className="row" style={{ gap: 8 }}>
            <PieceTag type={req.pieceType} />
            <StatusBadge status={req.status} />
          </div>
          <h1 style={{ marginTop: 8 }}>{req.title}</h1>
          <p style={{ whiteSpace: 'pre-wrap' }}>{req.description}</p>
          <div className="small">
            <Budget min={req.budgetMinFils} max={req.budgetMaxFils} />
            {req.neededBy && <span className="muted"> · needed by {formatDate(req.neededBy)}</span>}
          </div>
          {req.order && (
            <div className="notice ok" style={{ marginTop: 14, marginBottom: 0 }}>
              Your deposit was confirmed and the order is open. <Link href={`/orders/${req.order.id}`}>Go to the order →</Link>
            </div>
          )}
          {open && (
            <>
              <hr className="divider" />
              <ActionForm action={cancelRequestAction}>
                <input type="hidden" name="requestId" value={req.id} />
                <SubmitButton variant="danger" pendingText="Cancelling…">
                  Cancel request
                </SubmitButton>
              </ActionForm>
            </>
          )}
        </div>
        <div className="card">
          {photo ? <img src={photo} alt="Reference photo" style={{ borderRadius: 8, width: '100%' }} /> : <div className="empty small">No reference photo</div>}
        </div>
      </div>

      <h2 style={{ marginTop: 28 }}>
        {req.bids.length} {req.bids.length === 1 ? 'bid' : 'bids'}
      </h2>
      {req.bids.length === 0 && (
        <div className="card empty">
          <p>No bids yet. Tailors can see your request now.</p>
          <p className="small">Chat opens after you accept a bid and the deposit is confirmed.</p>
        </div>
      )}

      {req.bids.map((b) => {
        const revisedAfterDecline = b.revisions.some((r) => r.statusBefore === 'DECLINED')
        return (
          <div key={b.id} className="card">
            <div className="grid-2" style={{ gridTemplateColumns: '1.4fr 1fr' }}>
              <div>
                <div className="row between">
                  <Link href={`/tailors/${b.tailor.id}`} className="item-title">
                    {b.tailor.displayName}
                  </Link>
                  <div className="row" style={{ gap: 6 }}>
                    {revisedAfterDecline && b.status === 'PENDING' && <span className="badge info">revised after decline</span>}
                    <StatusBadge status={b.status} />
                  </div>
                </div>
                {b.note && <p style={{ marginTop: 8, whiteSpace: 'pre-wrap' }}>{b.note}</p>}
                <details style={{ marginTop: 8 }}>
                  <summary>
                    {b.revisions.length} {b.revisions.length === 1 ? 'version' : 'versions'} — see how this bid changed
                  </summary>
                  <ul className="history">
                    {b.revisions.map((r, i) => (
                      <li key={r.revisionNo}>
                        <span>
                          <strong>{i === 0 ? 'Current' : `#${r.revisionNo}`}</strong>{' '}
                          {formatKWD(r.upfrontFils)} + {formatKWD(r.completionFils)} · {r.turnaroundDays} days
                          {r.statusBefore === 'DECLINED' && <span className="muted"> (after you declined)</span>}
                        </span>
                        <span className="muted">{formatDateTime(r.createdAt)}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              </div>
              <div>
                <div className="grid-3" style={{ gridTemplateColumns: '1fr 1fr' }}>
                  <div className="stat">
                    <div className="stat-label">Upfront</div>
                    <div className="money">{formatKWD(b.upfrontFils)}</div>
                  </div>
                  <div className="stat">
                    <div className="stat-label">On completion</div>
                    <div className="money">{formatKWD(b.completionFils)}</div>
                  </div>
                  <div className="stat">
                    <div className="stat-label">Total</div>
                    <div className="money" style={{ fontWeight: 700 }}>
                      <Money fils={b.totalFils} />
                    </div>
                  </div>
                  <div className="stat">
                    <div className="stat-label">Turnaround</div>
                    <div>{b.turnaroundDays} days</div>
                  </div>
                </div>
                {open && b.status === 'PENDING' && (
                  <div className="row" style={{ marginTop: 12 }}>
                    <ActionForm action={startUpfrontPaymentAction}>
                      {/* Only the id is sent. The server reads the amount from the bid. */}
                      <input type="hidden" name="bidId" value={b.id} />
                      <SubmitButton pendingText="Opening checkout…">Accept &amp; pay {formatKWD(b.upfrontFils)}</SubmitButton>
                    </ActionForm>
                    <ActionForm action={declineBidAction}>
                      <input type="hidden" name="bidId" value={b.id} />
                      <SubmitButton variant="secondary" pendingText="Declining…">
                        Decline
                      </SubmitButton>
                    </ActionForm>
                  </div>
                )}
                {open && b.status === 'DECLINED' && (
                  <p className="small muted" style={{ marginTop: 12 }}>
                    You declined this bid. The tailor can still revise it; it will come back as pending.
                  </p>
                )}
              </div>
            </div>
          </div>
        )
      })}
    </>
  )
}
