import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth'
import { getPendingCheckout } from '@/lib/payments/mock-provider'
import { formatKWD } from '@/lib/money'
import { mockProviderSubmitAction } from '@/app/mock-provider/actions'
import { ActionForm } from '@/components/ActionForm'
import { SubmitButton } from '@/components/SubmitButton'

export default async function MockCheckoutPage({ params }: { params: Promise<{ paymentId: string }> }) {
  const me = await requireRole('CUSTOMER')
  const { paymentId } = await params
  // 404 unless mock payments are on, this is the payer, it's PENDING and not expired.
  const p = await getPendingCheckout(paymentId, me.id)
  if (!p) notFound()

  return (
    <div style={{ maxWidth: 480, margin: '12px auto' }}>
      <div className="notice info">
        <strong>Mock payment provider.</strong> In production this page would be on the provider&apos;s own domain (for example
        MyFatoorah or Tap), and the card details would never touch this app. No real money moves here.
      </div>
      <div className="card">
        <div className="eyebrow">Secure checkout · demo</div>
        <h1 style={{ marginBottom: 4 }}>{formatKWD(p.amountFils)}</h1>
        <p className="muted">
          {p.kind === 'UPFRONT' ? 'Deposit' : 'Balance'} for “{p.request.title}”
        </p>
        <p className="small muted">
          The amount shown was set by the server from the bid. Payment reference <span className="mono">{p.id}</span>.
        </p>
        <hr className="divider" />
        <ActionForm action={mockProviderSubmitAction}>
          <input type="hidden" name="paymentId" value={p.id} />
          <input type="hidden" name="outcome" value="PAID" />
          <SubmitButton block pendingText="Processing…">
            Approve payment
          </SubmitButton>
        </ActionForm>
        <div style={{ height: 8 }} />
        <ActionForm action={mockProviderSubmitAction}>
          <input type="hidden" name="paymentId" value={p.id} />
          <input type="hidden" name="outcome" value="FAILED" />
          <SubmitButton block variant="secondary" pendingText="Processing…">
            Simulate a declined card
          </SubmitButton>
        </ActionForm>
      </div>
    </div>
  )
}
