-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "passwordChangedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TailorProfile" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "bio" TEXT NOT NULL DEFAULT '',
    "city" TEXT NOT NULL DEFAULT '',
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TailorProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Request" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "pieceType" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "budgetMinFils" INTEGER,
    "budgetMaxFils" INTEGER,
    "neededBy" DATETIME,
    "referencePhotoId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "awardedAt" DATETIME,
    "cancelledAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Request_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Request_referencePhotoId_fkey" FOREIGN KEY ("referencePhotoId") REFERENCES "Upload" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Bid" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestId" TEXT NOT NULL,
    "tailorId" TEXT NOT NULL,
    "upfrontFils" INTEGER NOT NULL,
    "completionFils" INTEGER NOT NULL,
    "totalFils" INTEGER NOT NULL,
    "turnaroundDays" INTEGER NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "version" INTEGER NOT NULL DEFAULT 1,
    "declinedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Bid_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "Request" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Bid_tailorId_fkey" FOREIGN KEY ("tailorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BidRevision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bidId" TEXT NOT NULL,
    "revisionNo" INTEGER NOT NULL,
    "upfrontFils" INTEGER NOT NULL,
    "completionFils" INTEGER NOT NULL,
    "totalFils" INTEGER NOT NULL,
    "turnaroundDays" INTEGER NOT NULL,
    "note" TEXT,
    "statusBefore" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BidRevision_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "amountFils" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'KWD',
    "customerId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "bidId" TEXT NOT NULL,
    "bidVersion" INTEGER NOT NULL,
    "orderId" TEXT,
    "providerRef" TEXT,
    "expiresAt" DATETIME NOT NULL,
    "paidAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Payment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Payment_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "Request" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Payment_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Payment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestId" TEXT NOT NULL,
    "bidId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "tailorId" TEXT NOT NULL,
    "upfrontPaymentId" TEXT NOT NULL,
    "completionPaymentId" TEXT,
    "upfrontFils" INTEGER NOT NULL,
    "completionFils" INTEGER NOT NULL,
    "totalFils" INTEGER NOT NULL,
    "turnaroundDays" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACCEPTED',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME,
    "readyAt" DATETIME,
    "completedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "orders_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "Request" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "orders_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "orders_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "orders_tailorId_fkey" FOREIGN KEY ("tailorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "orders_upfrontPaymentId_fkey" FOREIGN KEY ("upfrontPaymentId") REFERENCES "Payment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "orders_completionPaymentId_fkey" FOREIGN KEY ("completionPaymentId") REFERENCES "Payment" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Message" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orderId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Message_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Message_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Review" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "tailorId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Review_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Review_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Review_tailorId_fkey" FOREIGN KEY ("tailorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Upload" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "storedName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Upload_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OrderPhoto" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "uploadId" TEXT NOT NULL,
    "inPortfolio" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrderPhoto_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "OrderPhoto_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "Upload" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RateLimit" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "count" INTEGER NOT NULL,
    "windowStart" DATETIME NOT NULL,
    "blockedUntil" DATETIME
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT,
    "entityId" TEXT,
    "ip" TEXT,
    "detail" TEXT,
    CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Request_referencePhotoId_key" ON "Request"("referencePhotoId");

-- CreateIndex
CREATE INDEX "Request_status_createdAt_idx" ON "Request"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Request_customerId_createdAt_idx" ON "Request"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "Bid_requestId_status_idx" ON "Bid"("requestId", "status");

-- CreateIndex
CREATE INDEX "Bid_tailorId_createdAt_idx" ON "Bid"("tailorId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Bid_requestId_tailorId_key" ON "Bid"("requestId", "tailorId");

-- CreateIndex
CREATE UNIQUE INDEX "BidRevision_bidId_revisionNo_key" ON "BidRevision"("bidId", "revisionNo");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_providerRef_key" ON "Payment"("providerRef");

-- CreateIndex
CREATE INDEX "Payment_requestId_status_idx" ON "Payment"("requestId", "status");

-- CreateIndex
CREATE INDEX "Payment_bidId_status_idx" ON "Payment"("bidId", "status");

-- CreateIndex
CREATE INDEX "Payment_orderId_status_idx" ON "Payment"("orderId", "status");

-- CreateIndex
CREATE INDEX "Payment_customerId_createdAt_idx" ON "Payment"("customerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "orders_requestId_key" ON "orders"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "orders_bidId_key" ON "orders"("bidId");

-- CreateIndex
CREATE UNIQUE INDEX "orders_upfrontPaymentId_key" ON "orders"("upfrontPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "orders_completionPaymentId_key" ON "orders"("completionPaymentId");

-- CreateIndex
CREATE INDEX "orders_customerId_status_idx" ON "orders"("customerId", "status");

-- CreateIndex
CREATE INDEX "orders_tailorId_status_idx" ON "orders"("tailorId", "status");

-- CreateIndex
CREATE INDEX "Message_orderId_id_idx" ON "Message"("orderId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Review_orderId_key" ON "Review"("orderId");

-- CreateIndex
CREATE INDEX "Review_tailorId_createdAt_idx" ON "Review"("tailorId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Upload_storedName_key" ON "Upload"("storedName");

-- CreateIndex
CREATE INDEX "Upload_ownerId_createdAt_idx" ON "Upload"("ownerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "OrderPhoto_uploadId_key" ON "OrderPhoto"("uploadId");

-- CreateIndex
CREATE INDEX "OrderPhoto_orderId_idx" ON "OrderPhoto"("orderId");

-- CreateIndex
CREATE INDEX "AuditLog_action_at_idx" ON "AuditLog"("action", "at");

-- CreateIndex
CREATE INDEX "AuditLog_userId_at_idx" ON "AuditLog"("userId", "at");


-- Database backstop for the rules in lib/. The app enforces every rule in code first;
-- these triggers make the same rules hold even if a code path is buggy or someone
-- writes to the database directly. Appended to the init migration.

-- ---------------------------------------------------------------- Users
CREATE TRIGGER user_role_valid BEFORE INSERT ON "User"
WHEN NEW.role NOT IN ('CUSTOMER', 'TAILOR')
BEGIN SELECT RAISE(ABORT, 'invalid role'); END;

CREATE TRIGGER user_role_immutable BEFORE UPDATE OF role ON "User"
WHEN NEW.role <> OLD.role
BEGIN SELECT RAISE(ABORT, 'role is immutable'); END;

-- ---------------------------------------------------------------- Append-only tables
CREATE TRIGGER bidrevision_no_update BEFORE UPDATE ON "BidRevision"
BEGIN SELECT RAISE(ABORT, 'BidRevision is append-only'); END;
CREATE TRIGGER bidrevision_no_delete BEFORE DELETE ON "BidRevision"
BEGIN SELECT RAISE(ABORT, 'BidRevision is append-only'); END;

CREATE TRIGGER review_no_update BEFORE UPDATE ON "Review"
BEGIN SELECT RAISE(ABORT, 'Review is immutable'); END;
CREATE TRIGGER review_no_delete BEFORE DELETE ON "Review"
BEGIN SELECT RAISE(ABORT, 'Review is immutable'); END;

CREATE TRIGGER message_no_update BEFORE UPDATE ON "Message"
BEGIN SELECT RAISE(ABORT, 'Message is immutable'); END;
CREATE TRIGGER message_no_delete BEFORE DELETE ON "Message"
BEGIN SELECT RAISE(ABORT, 'Message is immutable'); END;

CREATE TRIGGER auditlog_no_update BEFORE UPDATE ON "AuditLog"
BEGIN SELECT RAISE(ABORT, 'AuditLog is append-only'); END;
CREATE TRIGGER auditlog_no_delete BEFORE DELETE ON "AuditLog"
BEGIN SELECT RAISE(ABORT, 'AuditLog is append-only'); END;

-- ---------------------------------------------------------------- Requests
CREATE TRIGGER request_customer_role BEFORE INSERT ON "Request"
WHEN (SELECT role FROM "User" WHERE id = NEW.customerId) IS NOT 'CUSTOMER'
  OR NEW.status <> 'OPEN'
BEGIN SELECT RAISE(ABORT, 'requests are created OPEN by a customer'); END;

CREATE TRIGGER request_status_flow BEFORE UPDATE OF status ON "Request"
WHEN NEW.status <> OLD.status
  AND NOT (OLD.status = 'OPEN' AND NEW.status IN ('AWARDED', 'CANCELLED'))
BEGIN SELECT RAISE(ABORT, 'request status can only move OPEN -> AWARDED or CANCELLED'); END;

-- ---------------------------------------------------------------- Bids
CREATE TRIGGER bid_insert_rules BEFORE INSERT ON "Bid"
WHEN NEW.totalFils <> NEW.upfrontFils + NEW.completionFils
  OR NEW.upfrontFils < 1000 OR NEW.completionFils < 1000
  OR NEW.turnaroundDays < 1 OR NEW.turnaroundDays > 365
  OR NEW.status <> 'PENDING'
  OR (SELECT status FROM "Request" WHERE id = NEW.requestId) IS NOT 'OPEN'
  OR (SELECT role FROM "User" WHERE id = NEW.tailorId) IS NOT 'TAILOR'
BEGIN SELECT RAISE(ABORT, 'invalid bid'); END;

CREATE TRIGGER bid_update_amounts BEFORE UPDATE ON "Bid"
WHEN NEW.totalFils <> NEW.upfrontFils + NEW.completionFils
  OR NEW.upfrontFils < 1000 OR NEW.completionFils < 1000
  OR NEW.requestId <> OLD.requestId OR NEW.tailorId <> OLD.tailorId
BEGIN SELECT RAISE(ABORT, 'invalid bid update'); END;

CREATE TRIGGER bid_amounts_only_while_open BEFORE UPDATE ON "Bid"
WHEN (NEW.upfrontFils <> OLD.upfrontFils OR NEW.completionFils <> OLD.completionFils
      OR NEW.turnaroundDays <> OLD.turnaroundDays)
  AND (OLD.status NOT IN ('PENDING', 'DECLINED')
       OR (SELECT status FROM "Request" WHERE id = NEW.requestId) IS NOT 'OPEN')
BEGIN SELECT RAISE(ABORT, 'this bid can no longer change'); END;

CREATE TRIGGER bid_status_final BEFORE UPDATE OF status ON "Bid"
WHEN NEW.status <> OLD.status AND OLD.status IN ('ACCEPTED', 'LOST')
BEGIN SELECT RAISE(ABORT, 'bid status is final'); END;

-- ---------------------------------------------------------------- Payments
CREATE TRIGGER payment_core_immutable BEFORE UPDATE ON "Payment"
WHEN NEW.amountFils <> OLD.amountFils OR NEW.kind <> OLD.kind OR NEW.bidId <> OLD.bidId
  OR NEW.requestId <> OLD.requestId OR NEW.customerId <> OLD.customerId
  OR NEW.currency <> OLD.currency
BEGIN SELECT RAISE(ABORT, 'payment amount and parties are immutable'); END;

CREATE TRIGGER payment_insert_rules BEFORE INSERT ON "Payment"
WHEN NEW.status <> 'PENDING' OR NEW.amountFils <= 0
BEGIN SELECT RAISE(ABORT, 'payments are created PENDING with a positive amount'); END;

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
CREATE TRIGGER orders_require_paid_upfront BEFORE INSERT ON "orders"
WHEN NEW.status <> 'ACCEPTED'
  OR NEW.totalFils <> NEW.upfrontFils + NEW.completionFils
  OR NOT EXISTS (
    SELECT 1 FROM "Payment" p
    WHERE p.id = NEW.upfrontPaymentId AND p.kind = 'UPFRONT' AND p.status = 'PAID'
      AND p.bidId = NEW.bidId AND p.requestId = NEW.requestId
      AND p.customerId = NEW.customerId AND p.amountFils = NEW.upfrontFils)
BEGIN SELECT RAISE(ABORT, 'an order needs a PAID upfront payment for the same bid'); END;

CREATE TRIGGER orders_status_guard BEFORE UPDATE OF status ON "orders"
WHEN NEW.status <> OLD.status AND NOT (
     (OLD.status = 'ACCEPTED'    AND NEW.status = 'IN_PROGRESS')
  OR (OLD.status = 'IN_PROGRESS' AND NEW.status = 'READY')
  OR (OLD.status = 'READY'       AND NEW.status = 'COMPLETED'))
BEGIN SELECT RAISE(ABORT, 'orders only move forward one step at a time'); END;

CREATE TRIGGER orders_complete_requires_paid BEFORE UPDATE OF status ON "orders"
WHEN NEW.status = 'COMPLETED' AND OLD.status <> 'COMPLETED' AND NOT EXISTS (
    SELECT 1 FROM "Payment" p
    WHERE p.id = NEW.completionPaymentId AND p.kind = 'COMPLETION' AND p.status = 'PAID'
      AND p.orderId = NEW.id AND p.customerId = NEW.customerId
      AND p.amountFils = NEW.completionFils)
BEGIN SELECT RAISE(ABORT, 'completing an order needs a PAID completion payment'); END;

CREATE TRIGGER orders_snapshot_immutable BEFORE UPDATE ON "orders"
WHEN NEW.requestId <> OLD.requestId OR NEW.bidId <> OLD.bidId
  OR NEW.customerId <> OLD.customerId OR NEW.tailorId <> OLD.tailorId
  OR NEW.upfrontPaymentId <> OLD.upfrontPaymentId
  OR NEW.upfrontFils <> OLD.upfrontFils OR NEW.completionFils <> OLD.completionFils
  OR NEW.totalFils <> OLD.totalFils OR NEW.turnaroundDays <> OLD.turnaroundDays
BEGIN SELECT RAISE(ABORT, 'order snapshot is immutable'); END;

-- ---------------------------------------------------------------- Chat and reviews
CREATE TRIGGER message_participant BEFORE INSERT ON "Message"
WHEN NOT EXISTS (SELECT 1 FROM "orders" o
                 WHERE o.id = NEW.orderId AND (o.customerId = NEW.senderId OR o.tailorId = NEW.senderId))
BEGIN SELECT RAISE(ABORT, 'only the order''s customer and tailor can message'); END;

CREATE TRIGGER review_rules BEFORE INSERT ON "Review"
WHEN NEW.rating < 1 OR NEW.rating > 5 OR NOT EXISTS (
    SELECT 1 FROM "orders" o
    WHERE o.id = NEW.orderId AND o.status = 'COMPLETED'
      AND o.customerId = NEW.customerId AND o.tailorId = NEW.tailorId)
BEGIN SELECT RAISE(ABORT, 'reviews need a COMPLETED order by the same customer and tailor'); END;
