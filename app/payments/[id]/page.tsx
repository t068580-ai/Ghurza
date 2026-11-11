import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth'
import { db } from '@/lib/db'
import { idSchema } from '@/lib/validation'
import { Money, StatusBadge } from '@/components/ui'

// Where the provider sends the customer back. Read-only: it shows what the
// database says. Visiting this URL (or adding ?status=paid to it) proves nothing
// and changes nothing.
export default async function PaymentReturnPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireRole('CUSTOMER')
  const { id } = await params
  if (!idSchema.safeParse(id).success) notFound()
  const p = await db.payment.findFirst({
    where: { id, customerId: me.id },
    select: { id: true, kind: true, status: true, amountFils: true, requestId: true, orderId: true },
  })
  if (!p) notFound()

  return (
    <div style={{ maxWidth: 520, margin: '12px auto' }}>
      <div className="card">
        <div className="row between">
          <h1 style={{ margin: 0 }}>{p.kind === 'UPFRONT' ? 'Deposit' : 'Balance'}</h1>
          <StatusBadge status={p.status} />
        </div>
        <p style={{ fontSize: '1.3rem', fontWeight: 700, marginTop: 8 }}>
          <Money fils={p.amountFils} />
        </p>
        {p.status === 'PAID' && p.orderId && (
          <>
            <p>
              The provider confirmed this payment.{' '}
              {p.kind === 'UPFRONT' ? 'Your order is open and chat with your tailor is unlocked.' : 'Your order is complete.'}
            </p>
            <Link className="btn" href={`/orders/${p.orderId}`}>
              Go to the order
            </Link>
          </>
        )}
        {p.status === 'PENDING' && <p className="muted">Still waiting for the provider&apos;s confirmation. Refresh in a moment.</p>}
        {p.status === 'FAILED' && (
          <>
            <p>The provider declined this payment. Nothing was charged.</p>
            <Link className="btn secondary" href={`/customer/requests/${p.requestId}`}>
              Back to the request
            </Link>
          </>
        )}
        {(p.status === 'CANCELLED' || p.status === 'REFUND_DUE') && (
          <>
            <p>
              {p.status === 'REFUND_DUE'
                ? 'The bid changed while you were paying, so no order was created. This payment is flagged for a refund.'
                : 'This checkout was replaced by a newer one.'}
            </p>
            <Link className="btn secondary" href={`/customer/requests/${p.requestId}`}>
              Back to the request
            </Link>
          </>
        )}
      </div>
    </div>
  )
}
