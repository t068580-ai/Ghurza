import { requireRole } from '@/lib/auth'
import { listOrdersFor } from '@/lib/orders'
import { OrdersList } from '@/components/OrdersList'

export default async function TailorOrdersPage() {
  const me = await requireRole('TAILOR')
  const orders = await listOrdersFor(me.id, 'TAILOR')
  return <OrdersList orders={orders} role="TAILOR" />
}
