import { requireRole } from '@/lib/auth'
import { listOrdersFor } from '@/lib/orders'
import { OrdersList } from '@/components/OrdersList'

export default async function CustomerOrdersPage() {
  const me = await requireRole('CUSTOMER')
  const orders = await listOrdersFor(me.id, 'CUSTOMER')
  return <OrdersList orders={orders} role="CUSTOMER" />
}
