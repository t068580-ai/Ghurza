import Link from 'next/link'
import { ORDER_LABELS, type OrderStatus } from '@/lib/enums'
import { Money, PieceTag, StatusBadge, formatDate } from '@/components/ui'

type Row = {
  id: string
  status: string
  totalFils: number
  createdAt: Date
  request: { title: string; pieceType: string }
  customer: { displayName: string }
  tailor: { id: string; displayName: string }
}

export function OrdersList({ orders, role }: { orders: Row[]; role: 'CUSTOMER' | 'TAILOR' }) {
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">In the workshop</div>
          <h1>Orders</h1>
        </div>
      </div>
      <div className="card">
        {orders.length === 0 ? (
          <div className="empty">
            <p>No orders yet.</p>
            <p className="small">
              {role === 'CUSTOMER'
                ? 'An order opens when you accept a bid and the payment provider confirms your deposit.'
                : 'An order opens when a customer accepts your bid and their deposit is confirmed.'}
            </p>
          </div>
        ) : (
          orders.map((o) => (
            <Link key={o.id} href={`/orders/${o.id}`} className="item">
              <div style={{ flex: 1 }}>
                <div className="row" style={{ gap: 8 }}>
                  <PieceTag type={o.request.pieceType} />
                  <StatusBadge status={o.status} label={ORDER_LABELS[o.status as OrderStatus]} />
                </div>
                <div className="item-title" style={{ marginTop: 4 }}>
                  {o.request.title}
                </div>
                <div className="muted small">
                  {role === 'CUSTOMER' ? `Made by ${o.tailor.displayName}` : `For ${o.customer.displayName}`} · opened {formatDate(o.createdAt)}
                </div>
              </div>
              <div style={{ textAlign: 'right', fontWeight: 700 }}>
                <Money fils={o.totalFils} />
              </div>
            </Link>
          ))
        )}
      </div>
    </>
  )
}
