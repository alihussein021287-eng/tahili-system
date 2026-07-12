CREATE TYPE "PurchaseOrderStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ORDERED', 'PARTIALLY_RECEIVED', 'FULLY_RECEIVED', 'CANCELLED');

CREATE TABLE "purchase_orders" (
  "id" TEXT NOT NULL, "orderNo" TEXT NOT NULL, "supplierId" INTEGER NOT NULL,
  "orderDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "expectedDeliveryDate" TIMESTAMP(3),
  "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT', "createdById" TEXT NOT NULL,
  "approvedById" TEXT, "approvedAt" TIMESTAMP(3), "notes" TEXT, "cancellationReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "purchase_order_items" (
  "id" TEXT NOT NULL, "purchaseOrderId" TEXT NOT NULL, "medicationId" INTEGER, "materialName" TEXT,
  "unit" TEXT NOT NULL, "orderedQuantity" INTEGER NOT NULL, "receivedQuantity" INTEGER NOT NULL DEFAULT 0,
  "rejectedQuantity" INTEGER NOT NULL DEFAULT 0, "damagedQuantity" INTEGER NOT NULL DEFAULT 0,
  "unitPrice" DECIMAL(12,2), "batchNo" TEXT, "expiryDate" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "purchase_order_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "purchase_receipts" (
  "id" TEXT NOT NULL, "purchaseOrderId" TEXT NOT NULL, "receiptNo" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL, "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdById" TEXT NOT NULL, "notes" TEXT, "overrideReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "purchase_receipts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "purchase_receipt_items" (
  "id" TEXT NOT NULL, "receiptId" TEXT NOT NULL, "purchaseItemId" TEXT NOT NULL,
  "acceptedQuantity" INTEGER NOT NULL DEFAULT 0, "rejectedQuantity" INTEGER NOT NULL DEFAULT 0,
  "damagedQuantity" INTEGER NOT NULL DEFAULT 0, "batchNo" TEXT, "expiryDate" TIMESTAMP(3),
  "rejectionReason" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "purchase_receipt_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "purchase_order_attachments" (
  "id" TEXT NOT NULL, "purchaseOrderId" TEXT NOT NULL, "fileName" TEXT NOT NULL,
  "fileUrl" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "purchase_order_attachments_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "medication_batches" ADD COLUMN "purchaseOrderId" TEXT, ADD COLUMN "purchaseItemId" TEXT, ADD COLUMN "purchaseReceiptId" TEXT;
ALTER TABLE "stock_movements" ADD COLUMN "purchaseReceiptId" TEXT;

CREATE UNIQUE INDEX "purchase_orders_orderNo_key" ON "purchase_orders"("orderNo");
CREATE INDEX "purchase_orders_status_expectedDeliveryDate_idx" ON "purchase_orders"("status", "expectedDeliveryDate");
CREATE INDEX "purchase_orders_supplierId_orderDate_idx" ON "purchase_orders"("supplierId", "orderDate");
CREATE INDEX "purchase_order_items_purchaseOrderId_idx" ON "purchase_order_items"("purchaseOrderId");
CREATE INDEX "purchase_order_items_medicationId_idx" ON "purchase_order_items"("medicationId");
CREATE UNIQUE INDEX "purchase_receipts_receiptNo_key" ON "purchase_receipts"("receiptNo");
CREATE UNIQUE INDEX "purchase_receipts_idempotencyKey_key" ON "purchase_receipts"("idempotencyKey");
CREATE INDEX "purchase_receipts_purchaseOrderId_receivedAt_idx" ON "purchase_receipts"("purchaseOrderId", "receivedAt");
CREATE UNIQUE INDEX "purchase_receipt_items_receiptId_purchaseItemId_key" ON "purchase_receipt_items"("receiptId", "purchaseItemId");
CREATE INDEX "purchase_receipt_items_purchaseItemId_idx" ON "purchase_receipt_items"("purchaseItemId");
CREATE INDEX "purchase_order_attachments_purchaseOrderId_idx" ON "purchase_order_attachments"("purchaseOrderId");
CREATE INDEX "medication_batches_purchaseOrderId_idx" ON "medication_batches"("purchaseOrderId");
CREATE INDEX "medication_batches_purchaseReceiptId_idx" ON "medication_batches"("purchaseReceiptId");
CREATE INDEX "stock_movements_purchaseReceiptId_idx" ON "stock_movements"("purchaseReceiptId");

ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_medicationId_fkey" FOREIGN KEY ("medicationId") REFERENCES "medications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_receipts" ADD CONSTRAINT "purchase_receipts_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_receipts" ADD CONSTRAINT "purchase_receipts_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_receipt_items" ADD CONSTRAINT "purchase_receipt_items_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "purchase_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "purchase_receipt_items" ADD CONSTRAINT "purchase_receipt_items_purchaseItemId_fkey" FOREIGN KEY ("purchaseItemId") REFERENCES "purchase_order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_order_attachments" ADD CONSTRAINT "purchase_order_attachments_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "medication_batches" ADD CONSTRAINT "medication_batches_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "medication_batches" ADD CONSTRAINT "medication_batches_purchaseItemId_fkey" FOREIGN KEY ("purchaseItemId") REFERENCES "purchase_order_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "medication_batches" ADD CONSTRAINT "medication_batches_purchaseReceiptId_fkey" FOREIGN KEY ("purchaseReceiptId") REFERENCES "purchase_receipts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_purchaseReceiptId_fkey" FOREIGN KEY ("purchaseReceiptId") REFERENCES "purchase_receipts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
