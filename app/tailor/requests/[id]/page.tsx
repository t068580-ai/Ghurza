import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth'
import { getRequestForTailor } from '@/lib/bids'
import { fileUrl } from '@/lib/uploads'
import { filsToInput, formatKWD } from '@/lib/money'
import { placeBidAction, reviseBidAction } from '@/app/tailor/actions'
import { ActionForm } from '@/components/ActionForm'
import { SubmitButton } from '@/components/SubmitButton'
import { Budget, PieceTag, StatusBadge, formatDate, formatDateTime } from '@/components/ui'

export default async function TailorRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireRole('TAILOR')
  const { id } = await params
  const data = await getRequestForTailor(id, me.id)
  if (!data) notFound()
  const { request: req, myBid, competition } = data
  const photo = fileUrl(req.referencePhotoId)
  const canBid = req.status === 'OPEN' && (!myBid || myBid.status === 'PENDING' || myBid.status === 'DECLINED')

  return (
    <>
      <p className="small">
        <Link href="/tailor/requests">← Open requests</Link>
      </p>
      <div className="grid-2">
        <div className="stack">
          <div className="card">
            <div className="row" style={{ gap: 8 }}>
              <PieceTag type={req.pieceType} />
              <StatusBadge status={req.status} />
              {myBid && <StatusBadge status={myBid.status} label={`your bid: ${myBid.status.toLowerCase()}`} />}
            </div>
            <h1 style={{ marginTop: 8 }}>{req.title}</h1>
            <p style={{ whiteSpace: 'pre-wrap' }}>{req.description}</p>
            <div className="small">
              <Budget min={req.budgetMinFils} max={req.budgetMaxFils} />
              {req.neededBy && <span className="muted"> · needed by {formatDate(req.neededBy)}</span>}
            </div>
            {photo && <img src={photo} alt="Reference photo" style={{ borderRadius: 8, marginTop: 14, maxHeight: 420 }} />}
          </div>

          {myBid && (
            <div className="card">
              <h2>Your revisions</h2>
              <p className="muted small">The customer sees every one of these, not just your latest numbers.</p>
              <ul className="history">
                {myBid.revisions.map((r, i) => (
                  <li key={r.revisionNo}>
                    <span>
                      <strong>{i === 0 ? 'Current' : `#${r.revisionNo}`}</strong> {formatKWD(r.upfrontFils)} + {formatKWD(r.completionFils)} ·{' '}
                      {r.turnaroundDays} days
                      {r.statusBefore === 'DECLINED' && <span className="muted"> (revised after a decline)</span>}
                    </span>
                    <span className="muted">{formatDateTime(r.createdAt)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="stack">
          <div className="card">
            <h2>The competition</h2>
            <p className="muted small">
              You can see roughly where bidding stands, never who else bid or what any one of them quoted. Ranges appear once at
              least two other tailors have bid.
            </p>
            <div className="grid-3" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
              <div className="stat">
                <div className="stat-label">Other bids</div>
                <div className="stat-value">{competition.competitorCount}</div>
              </div>
              <div className="stat">
                <div className="stat-label">Lowest total</div>
                <div className="stat-value small">
                  {competition.lowestTotalRange
                    ? competition.lowestTotalRange.toFils > competition.lowestTotalRange.fromFils
                      ? `${competition.lowestTotalRange.fromFils / 1000} to under ${Math.ceil(competition.lowestTotalRange.toFils / 1000)} KWD`
                      : `${competition.lowestTotalRange.fromFils / 1000} KWD or more`
                    : '—'}
                </div>
              </div>
              <div className="stat">
                <div className="stat-label">Fastest</div>
                <div className="stat-value small">{competition.fastestTurnaround ?? '—'}</div>
              </div>
            </div>
          </div>

          {canBid && (
            <div className="card">
              <h2>{myBid ? 'Revise your bid' : 'Place your bid'}</h2>
              {myBid?.status === 'DECLINED' && (
                <div className="notice info">The customer declined this bid. Revising it sends it back to them as pending.</div>
              )}
              <ActionForm action={myBid ? reviseBidAction : placeBidAction}>
                {myBid ? (
                  <>
                    <input type="hidden" name="bidId" value={myBid.id} />
                    <input type="hidden" name="expectedVersion" value={myBid.version} />
                  </>
                ) : (
                  <input type="hidden" name="requestId" value={req.id} />
                )}
                <div className="fields-2">
                  <div className="field">
                    <label htmlFor="upfront">
                      Upfront (KWD) <span className="hint">paid when accepted</span>
                    </label>
                    <input id="upfront" name="upfront" required inputMode="decimal" pattern="\d{1,5}(\.\d{1,3})?" defaultValue={myBid ? filsToInput(myBid.upfrontFils) : ''} />
                  </div>
                  <div className="field">
                    <label htmlFor="completion">
                      Final (KWD) <span className="hint">paid when ready</span>
                    </label>
                    <input id="completion" name="completion" required inputMode="decimal" pattern="\d{1,5}(\.\d{1,3})?" defaultValue={myBid ? filsToInput(myBid.completionFils) : ''} />
                  </div>
                </div>
                <div className="field">
                  <label htmlFor="turnaroundDays">Turnaround (days)</label>
                  <input id="turnaroundDays" name="turnaroundDays" type="number" min={1} max={365} required defaultValue={myBid?.turnaroundDays ?? 14} />
                </div>
                <div className="field">
                  <label htmlFor="note">
                    Note to the customer <span className="hint">optional</span>
                  </label>
                  <textarea id="note" name="note" maxLength={1000} defaultValue={myBid?.note ?? ''} style={{ minHeight: 80 }} />
                </div>
                <SubmitButton block pendingText="Saving…">
                  {myBid ? 'Revise bid' : 'Place bid'}
                </SubmitButton>
              </ActionForm>
            </div>
          )}
          {myBid && (myBid.status === 'ACCEPTED' || myBid.status === 'LOST') && (
            <div className="card">
              {myBid.status === 'ACCEPTED' ? (
                <p>Your bid was accepted and the deposit is confirmed. Find it under Orders.</p>
              ) : (
                <p className="muted">This request was awarded to another tailor.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
