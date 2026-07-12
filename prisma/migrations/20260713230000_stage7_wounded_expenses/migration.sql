CREATE TYPE "WoundedExpenseStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'READY_FOR_PAYMENT', 'PAID', 'CANCELLED');
CREATE TYPE "ExpenseApprovalDecision" AS ENUM ('APPROVED', 'REJECTED');
CREATE TYPE "ExpenseCorrectionType" AS ENUM ('CORRECTION', 'REVERSAL');

ALTER TABLE "OrgSetting" ADD COLUMN "expenseApprovalLevels" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE "wounded_expenses" (
  "id" TEXT NOT NULL, "voucherNo" TEXT NOT NULL, "patientId" TEXT NOT NULL,
  "beneficiary" TEXT NOT NULL, "beneficiaryEntity" TEXT, "expenseType" TEXT NOT NULL,
  "reason" TEXT NOT NULL, "amount" DECIMAL(14,2) NOT NULL, "currency" TEXT NOT NULL DEFAULT 'IQD',
  "requestDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "dueDate" TIMESTAMP(3), "paidAt" TIMESTAMP(3),
  "createdById" TEXT NOT NULL, "paidById" TEXT, "notes" TEXT, "costCenter" TEXT, "department" TEXT,
  "paymentMethod" TEXT, "financialReference" TEXT, "payoutIdempotencyKey" TEXT,
  "status" "WoundedExpenseStatus" NOT NULL DEFAULT 'DRAFT', "requiredApprovalLevels" INTEGER NOT NULL DEFAULT 1,
  "parentExpenseId" TEXT, "correctionType" "ExpenseCorrectionType", "correctionReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "wounded_expenses_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "wounded_expense_approvals" (
  "id" TEXT NOT NULL, "expenseId" TEXT NOT NULL, "level" INTEGER NOT NULL,
  "decision" "ExpenseApprovalDecision" NOT NULL, "userId" TEXT NOT NULL, "reason" TEXT,
  "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "wounded_expense_approvals_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "wounded_expense_attachments" (
  "id" TEXT NOT NULL, "expenseId" TEXT NOT NULL, "fileName" TEXT NOT NULL, "fileUrl" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "wounded_expense_attachments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "wounded_expenses_voucherNo_key" ON "wounded_expenses"("voucherNo");
CREATE UNIQUE INDEX "wounded_expenses_payoutIdempotencyKey_key" ON "wounded_expenses"("payoutIdempotencyKey");
CREATE INDEX "wounded_expenses_patientId_requestDate_idx" ON "wounded_expenses"("patientId", "requestDate");
CREATE INDEX "wounded_expenses_status_dueDate_idx" ON "wounded_expenses"("status", "dueDate");
CREATE INDEX "wounded_expenses_expenseType_requestDate_idx" ON "wounded_expenses"("expenseType", "requestDate");
CREATE INDEX "wounded_expenses_parentExpenseId_idx" ON "wounded_expenses"("parentExpenseId");
CREATE UNIQUE INDEX "wounded_expense_approvals_expenseId_level_key" ON "wounded_expense_approvals"("expenseId", "level");
CREATE INDEX "wounded_expense_approvals_userId_decidedAt_idx" ON "wounded_expense_approvals"("userId", "decidedAt");
CREATE INDEX "wounded_expense_attachments_expenseId_idx" ON "wounded_expense_attachments"("expenseId");

ALTER TABLE "wounded_expenses" ADD CONSTRAINT "wounded_expenses_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wounded_expenses" ADD CONSTRAINT "wounded_expenses_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wounded_expenses" ADD CONSTRAINT "wounded_expenses_paidById_fkey" FOREIGN KEY ("paidById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "wounded_expenses" ADD CONSTRAINT "wounded_expenses_parentExpenseId_fkey" FOREIGN KEY ("parentExpenseId") REFERENCES "wounded_expenses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wounded_expense_approvals" ADD CONSTRAINT "wounded_expense_approvals_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "wounded_expenses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wounded_expense_approvals" ADD CONSTRAINT "wounded_expense_approvals_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wounded_expense_attachments" ADD CONSTRAINT "wounded_expense_attachments_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "wounded_expenses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
