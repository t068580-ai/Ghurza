-- Database backstop for the rules in lib/. The app enforces every rule in code first;
-- these triggers make the same rules hold even if a code path is buggy or someone
-- writes to the database directly. Applied by the init migration AND re-applied on
-- every `npm run dev` (predev), because Prisma rebuilds SQLite tables during some
-- migrations and a rebuilt table silently loses its triggers. Idempotent.

-- ---------------------------------------------------------------- Users
DROP TRIGGER IF EXISTS user_role_valid;
CREATE TRIGGER user_role_valid BEFORE INSERT ON "User"
WHEN NEW.role NOT IN ('CUSTOMER', 'TAILOR')
BEGIN SELECT RAISE(ABORT, 'invalid role'); END;

DROP TRIGGER IF EXISTS user_role_immutable;
CREATE TRIGGER user_role_immutable BEFORE UPDATE OF role ON "User"
WHEN NEW.role <> OLD.role
BEGIN SELECT RAISE(ABORT, 'role is immutable'); END;

-- ---------------------------------------------------------------- Append-only tables
DROP TRIGGER IF EXISTS bidrevision_no_update;
CREATE TRIGGER bidrevision_no_update BEFORE UPDATE ON "BidRevision"
BEGIN SELECT RAISE(ABORT, 'BidRevision is append-only'); END;
DROP TRIGGER IF EXISTS bidrevision_no_delete;
CREATE TRIGGER bidrevision_no_delete BEFORE DELETE ON "BidRevision"
BEGIN SELECT RAISE(ABORT, 'BidRevision is append-only'); END;

DROP TRIGGER IF EXISTS review_no_update;
CREATE TRIGGER review_no_update BEFORE UPDATE ON "Review"
BEGIN SELECT RAISE(ABORT, 'Review is immutable'); END;
DROP TRIGGER IF EXISTS review_no_delete;
CREATE TRIGGER review_no_delete BEFORE DELETE ON "Review"
BEGIN SELECT RAISE(ABORT, 'Review is immutable'); END;

DROP TRIGGER IF EXISTS message_no_update;
CREATE TRIGGER message_no_update BEFORE UPDATE ON "Message"
BEGIN SELECT RAISE(ABORT, 'Message is immutable'); END;
DROP TRIGGER IF EXISTS message_no_delete;
CREATE TRIGGER message_no_delete BEFORE DELETE ON "Message"
BEGIN SELECT RAISE(ABORT, 'Message is immutable'); END;

DROP TRIGGER IF EXISTS auditlog_no_update;
CREATE TRIGGER auditlog_no_update BEFORE UPDATE ON "AuditLog"
BEGIN SELECT RAISE(ABORT, 'AuditLog is append-only'); END;
DROP TRIGGER IF EXISTS auditlog_no_delete;
CREATE TRIGGER auditlog_no_delete BEFORE DELETE ON "AuditLog"
BEGIN SELECT RAISE(ABORT, 'AuditLog is append-only'); END;

-- ---------------------------------------------------------------- Requests
DROP TRIGGER IF EXISTS request_customer_role;
CREATE TRIGGER request_customer_role BEFORE INSERT ON "Request"
WHEN (SELECT role FROM "User" WHERE id = NEW.customerId) IS NOT 'CUSTOMER'
  OR NEW.status <> 'OPEN'
BEGIN SELECT RAISE(ABORT, 'requests are created OPEN by a customer'); END;

DROP TRIGGER IF EXISTS request_status_flow;
CREATE TRIGGER request_status_flow BEFORE UPDATE OF status ON "Request"
WHEN NEW.status <> OLD.status
  AND NOT (OLD.status = 'OPEN' AND NEW.status IN ('AWARDED', 'CANCELLED'))
BEGIN SELECT RAISE(ABORT, 'request status can only move OPEN -> AWARDED or CANCELLED'); END;

-- ---------------------------------------------------------------- Bids
DROP TRIGGER IF EXISTS bid_insert_rules;
CREATE TRIGGER bid_insert_rules BEFORE INSERT ON "Bid"
WHEN NEW.totalFils <> NEW.upfrontFils + NEW.completionFils
  OR NEW.upfrontFils < 1000 OR NEW.completionFils < 1000
  OR NEW.turnaroundDays < 1 OR NEW.turnaroundDays > 365
  OR NEW.status <> 'PENDING'
  OR (SELECT status FROM "Request" WHERE id = NEW.requestId) IS NOT 'OPEN'
  OR (SELECT role FROM "User" WHERE id = NEW.tailorId) IS NOT 'TAILOR'
BEGIN SELECT RAISE(ABORT, 'invalid bid'); END;

DROP TRIGGER IF EXISTS bid_update_amounts;
CREATE TRIGGER bid_update_amounts BEFORE UPDATE ON "Bid"
WHEN NEW.totalFils <> NEW.upfrontFils + NEW.completionFils
  OR NEW.upfrontFils < 1000 OR NEW.completionFils < 1000
  OR NEW.requestId <> OLD.requestId OR NEW.tailorId <> OLD.tailorId
BEGIN SELECT RAISE(ABORT, 'invalid bid update'); END;

DROP TRIGGER IF EXISTS bid_amounts_only_while_open;
CREATE TRIGGER bid_amounts_only_while_open BEFORE UPDATE ON "Bid"
WHEN (NEW.upfrontFils <> OLD.upfrontFils OR NEW.completionFils <> OLD.completionFils
      OR NEW.turnaroundDays <> OLD.turnaroundDays)
  AND (OLD.status NOT IN ('PENDING', 'DECLINED')
       OR (SELECT status FROM "Request" WHERE id = NEW.requestId) IS NOT 'OPEN')
BEGIN SELECT RAISE(ABORT, 'this bid can no longer change'); END;

DROP TRIGGER IF EXISTS bid_status_final;
CREATE TRIGGER bid_status_final BEFORE UPDATE OF status ON "Bid"
WHEN NEW.status <> OLD.status AND OLD.status IN ('ACCEPTED', 'LOST')
BEGIN SELECT RAISE(ABORT, 'bid status is final'); END;

-- ---------------------------------------------------------------- Payments
DROP TRIGGER IF EXISTS payment_core_immutable;
CREATE TRIGGER payment_core_immutable BEFORE UPDATE ON "Payment"
WHEN NEW.amountFils <> OLD.amountFils OR NEW.kind <> OLD.kind OR NEW.bidId <> OLD.bidId
  OR NEW.requestId <> OLD.requestId OR NEW.customerId <> OLD.customerId
  OR NEW.currency <> OLD.currency
BEGIN SELECT RAISE(ABORT, 'payment amount and parties are immutable'); END;

DROP TRIGGER IF EXISTS payment_insert_rules;
CREATE TRIGGER payment_insert_rules BEFORE INSERT ON "Payment"
WHEN NEW.status <> 'PENDING' OR NEW.amountFils <= 0
BEGIN SELECT RAISE(ABORT, 'payments are created PENDING with a positive amount'); END;

DROP TRIGGER IF EXISTS payment_status_flow;
CREATE TRIGGER payment_status_flow BEFORE UPDATE OF status ON "Payment"
WHEN NEW.status <> OLD.status AND NOT (
     (OLD.status = 'PENDING' AND NEW.status IN ('PAID', 'FAILED', 'CANCELLED'))
  OR (OLD.status IN ('CANCELLED', 'FAILED') AND NEW.status = 'REFUND_DUE')
  OR (OLD.status = 'PAID' AND NEW.status = 'REFUND_DUE'
      AND NOT EXISTS (SELECT 1 FROM "orders" o
                      WHERE o.upfrontPaymentId = OLD.id OR o.completionPaymentId = OLD.id))
)
BEGIN SELECT RAISE(ABORT, 'illegal payment status change'); END;

-- ---------------------------------------------------------------- Orders
DROP TRIGGER IF EXISTS orders_require_paid_upfront;
CREATE TRIGGER orders_require_paid_upfront BEFORE INSERT ON "orders"
WHEN NEW.status <> 'ACCEPTED'
  OR NEW.totalFils <> NEW.upfrontFils + NEW.completionFils
  OR NOT EXISTS (
    SELECT 1 FROM "Payment" p
    WHERE p.id = NEW.upfrontPaymentId AND p.kind = 'UPFRONT' AND p.status = 'PAID'
      AND p.bidId = NEW.bidId AND p.requestId = NEW.requestId
      AND p.customerId = NEW.customerId AND p.amountFils = NEW.upfrontFils)
BEGIN SELECT RAISE(ABORT, 'an order needs a PAID upfront payment for the same bid'); END;

DROP TRIGGER IF EXISTS orders_status_guard;
CREATE TRIGGER orders_status_guard BEFORE UPDATE OF status ON "orders"
WHEN NEW.status <> OLD.status AND NOT (
     (OLD.status = 'ACCEPTED'    AND NEW.status = 'IN_PROGRESS')
  OR (OLD.status = 'IN_PROGRESS' AND NEW.status = 'READY')
  OR (OLD.status = 'READY'       AND NEW.status = 'COMPLETED'))
BEGIN SELECT RAISE(ABORT, 'orders only move forward one step at a time'); END;

DROP TRIGGER IF EXISTS orders_complete_requires_paid;
CREATE TRIGGER orders_complete_requires_paid BEFORE UPDATE OF status ON "orders"
WHEN NEW.status = 'COMPLETED' AND OLD.status <> 'COMPLETED' AND NOT EXISTS (
    SELECT 1 FROM "Payment" p
    WHERE p.id = NEW.completionPaymentId AND p.kind = 'COMPLETION' AND p.status = 'PAID'
      AND p.orderId = NEW.id AND p.customerId = NEW.customerId
      AND p.amountFils = NEW.completionFils)
BEGIN SELECT RAISE(ABORT, 'completing an order needs a PAID completion payment'); END;

DROP TRIGGER IF EXISTS orders_snapshot_immutable;
CREATE TRIGGER orders_snapshot_immutable BEFORE UPDATE ON "orders"
WHEN NEW.requestId <> OLD.requestId OR NEW.bidId <> OLD.bidId
  OR NEW.customerId <> OLD.customerId OR NEW.tailorId <> OLD.tailorId
  OR NEW.upfrontPaymentId <> OLD.upfrontPaymentId
  OR NEW.upfrontFils <> OLD.upfrontFils OR NEW.completionFils <> OLD.completionFils
  OR NEW.totalFils <> OLD.totalFils OR NEW.turnaroundDays <> OLD.turnaroundDays
BEGIN SELECT RAISE(ABORT, 'order snapshot is immutable'); END;

-- ---------------------------------------------------------------- Chat and reviews
DROP TRIGGER IF EXISTS message_participant;
CREATE TRIGGER message_participant BEFORE INSERT ON "Message"
WHEN NOT EXISTS (SELECT 1 FROM "orders" o
                 WHERE o.id = NEW.orderId AND (o.customerId = NEW.senderId OR o.tailorId = NEW.senderId))
BEGIN SELECT RAISE(ABORT, 'only the order''s customer and tailor can message'); END;

DROP TRIGGER IF EXISTS review_rules;
CREATE TRIGGER review_rules BEFORE INSERT ON "Review"
WHEN NEW.rating < 1 OR NEW.rating > 5 OR NOT EXISTS (
    SELECT 1 FROM "orders" o
    WHERE o.id = NEW.orderId AND o.status = 'COMPLETED'
      AND o.customerId = NEW.customerId AND o.tailorId = NEW.tailorId)
BEGIN SELECT RAISE(ABORT, 'reviews need a COMPLETED order by the same customer and tailor'); END;
