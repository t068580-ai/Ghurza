import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireUser } from '@/lib/auth'
import { getOrderDetail } from '@/lib/orders'
import { listMessagesAfter } from '@/lib/messages'
import { fileUrl } from '@/lib/uploads'
import { formatKWD } from '@/lib/money'
import { ORDER_LABELS, ORDER_STATUS, type OrderStatus } from '@/lib/enums'
import {
  addPhotoAction,
  markReadyAction,
  sendMessageAction,
  startCompletionPaymentAction,
  startWorkAction,
  submitReviewAction,
} from '@/app/orders/actions'
import { ActionForm } from '@/components/ActionForm'
import { SubmitButton } from '@/components/SubmitButton'
import { ChatBox } from '@/components/ChatBox'
import { Money, PieceTag, Stars, StatusBadge, formatDate } from '@/components/ui'

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser()
  const { id } = await params
  // One gate for everything on this page: you must be this order's customer or tailor.
  const order = await getOrderDetail(id, me.id)
  if (!order) notFound()
  const messages = (await listMessagesAfter(order.id, me.id, 0, 100)) ?? []

  const isTailor = me.id === order.tailorId
  const isCustomer = me.id === order.customerId
  const status = order.status as OrderStatus
  const stepIndex = ORDER_STATUS.indexOf(status)
  const upfront = order.payments.find((p) => p.kind === 'UPFRONT' && p.status === 'PAID')
  const completion = order.payments.find((p) => p.kind === 'COMPLETION' && p.status === 'PAID')

  return (
    <>
      <p className="small">
        <Link href={isTailor ? '/tailor/orders' : '/customer/orders'}>← Orders</Link>
      </p>
      <div className="page-head">
        <div>
          <div className="row" style={{ gap: 8 }}>
            <PieceTag type={order.request.pieceType} />
            <StatusBadge status={order.status} label={ORDER_LABELS[status]} />
          </div>
          <h1 style={{ marginTop: 8 }}>{order.request.title}</h1>
          <p className="muted">
            {isCustomer ? (
              <>
                Made by <Link href={`/tailors/${order.tailor.id}`}>{order.tailor.displayName}</Link>
              </>
            ) : (
              <>For {order.customer.displayName}</>
            )}{' '}
            · opened {formatDate(order.createdAt)}
          </p>
        </div>
      </div>

      <ol className="steps" aria-label="Order progress">
        {ORDER_STATUS.map((s, i) => (
          <li key={s} className={i < stepIndex ? 'done' : i === stepIndex ? 'now' : ''}>
            {ORDER_LABELS[s]}
          </li>
        ))}
      </ol>

      <div className="grid-2">
        <div className="stack">
          <div className="card">
            <h2>Next step</h2>
            {status === 'ACCEPTED' && isTailor && (
              <ActionForm action={startWorkAction}>
                <input type="hidden" name="orderId" value={order.id} />
                <p className="muted small">The deposit is confirmed. Start when you begin cutting.</p>
                <SubmitButton>Start work</SubmitButton>
              </ActionForm>
            )}
            {status === 'IN_PROGRESS' && isTailor && (
              <ActionForm action={markReadyAction}>
                <input type="hidden" name="orderId" value={order.id} />
                <p className="muted small">Add photos of the finished piece below, then mark it ready so the customer can pay the balance.</p>
                <SubmitButton>Mark ready</SubmitButton>
              </ActionForm>
            )}
            {status === 'READY' && isCustomer && !order.completionPaymentId && (
              <ActionForm action={startCompletionPaymentAction}>
                <input type="hidden" name="orderId" value={order.id} />
                <p className="muted small">Your tailor marked the piece ready. Pay the balance through the payment provider to complete the order.</p>
                <SubmitButton pendingText="Opening checkout…">Pay balance {formatKWD(order.completionFils)}</SubmitButton>
              </ActionForm>
            )}
            {status === 'ACCEPTED' && isCustomer && <p className="muted">Waiting for the tailor to start.</p>}
            {status === 'IN_PROGRESS' && isCustomer && <p className="muted">Your piece is being made.</p>}
            {status === 'READY' && isTailor && <p className="muted">Waiting for the customer to pay the balance.</p>}
            {status === 'COMPLETED' && <p>Paid in full. Arrange pickup or delivery in the chat.</p>}
          </div>

          {(order.photos.length > 0 || (isTailor && (status === 'IN_PROGRESS' || status === 'READY'))) && (
            <div className="card">
              <h2>The finished piece</h2>
              {order.photos.length > 0 && (
                <div className="portfolio">
                  {order.photos.map((p) => (
                    <img key={p.uploadId} src={fileUrl(p.uploadId)!} alt="Finished piece" />
                  ))}
                </div>
              )}
              {isTailor && (status === 'IN_PROGRESS' || status === 'READY') && order.photos.length < 6 && (
                <ActionForm action={addPhotoAction} className="stack">
                  <input type="hidden" name="orderId" value={order.id} />
                  <input name="photo" type="file" accept="image/jpeg,image/png" required aria-label="Finished piece photo" />
                  <label className="row" style={{ fontWeight: 500, gap: 6 }}>
                    <input type="checkbox" name="inPortfolio" defaultChecked style={{ width: 'auto' }} /> Show in my public portfolio once completed
                  </label>
                  <SubmitButton variant="secondary" pendingText="Uploading…">
                    Add photo
                  </SubmitButton>
                </ActionForm>
              )}
            </div>
          )}

          <div className="card">
            <h2>Messages</h2>
            <p className="muted small">Only you and {isTailor ? order.customer.displayName : order.tailor.displayName} can see this.</p>
            <ChatBox orderId={order.id} initial={messages} send={sendMessageAction} />
          </div>
        </div>

        <div className="stack">
          <div className="card">
            <h2>Order summary</h2>
            <ul className="history">
              <li>
                <span>Upfront</span>
                <span>
                  <Money fils={order.upfrontFils} /> {upfront && <span className="badge ok">paid</span>}
                </span>
              </li>
              <li>
                <span>On completion</span>
                <span>
                  <Money fils={order.completionFils} /> {completion && <span className="badge ok">paid</span>}
                </span>
              </li>
              <li>
                <strong>Total</strong>
                <strong>
                  <Money fils={order.totalFils} />
                </strong>
              </li>
              <li>
                <span>Turnaround</span>
                <span>{order.turnaroundDays} days</span>
              </li>
            </ul>
            <p className="small muted" style={{ marginTop: 10 }}>
              This order exists because the payment provider confirmed the deposit with a signed callback, not because anyone clicked a button.
            </p>
          </div>

          {status === 'COMPLETED' && (
            <div className="card">
              <h2>Review</h2>
              {order.review ? (
                <>
                  <Stars value={order.review.rating} />
                  <p style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>{order.review.text}</p>
                  <p className="muted small">Reviews are permanent and can&apos;t be edited.</p>
                </>
              ) : isCustomer ? (
                <ActionForm action={submitReviewAction}>
                  <input type="hidden" name="orderId" value={order.id} />
                  <div className="field">
                    <label htmlFor="rating">Rating</label>
                    <select id="rating" name="rating" defaultValue="5">
                      {[5, 4, 3, 2, 1].map((n) => (
                        <option key={n} value={n}>
                          {'★'.repeat(n)} ({n})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="text">Your review</label>
                    <textarea id="text" name="text" required minLength={10} maxLength={2000} />
                  </div>
                  <p className="muted small">A review is permanent once posted.</p>
                  <SubmitButton pendingText="Posting…">Post review</SubmitButton>
                </ActionForm>
              ) : (
                <p className="muted">No review yet.</p>
              )}
            </div>
          )}

          <div className="card">
            <h2>Brief</h2>
            <p className="small" style={{ whiteSpace: 'pre-wrap' }}>
              {order.request.description}
            </p>
            {order.request.referencePhotoId && <img src={fileUrl(order.request.referencePhotoId)!} alt="Reference" style={{ borderRadius: 8 }} />}
          </div>
        </div>
      </div>
    </>
  )
}
