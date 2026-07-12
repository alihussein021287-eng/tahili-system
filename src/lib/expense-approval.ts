export type ExistingExpenseApproval = { userId: string };

export function assertDistinctExpenseApprover(
  approvals: ExistingExpenseApproval[],
  actorId: string,
) {
  if (approvals.some((approval) => approval.userId === actorId)) {
    throw new Error("لا يجوز للمستخدم اعتماد أكثر من مستوى للصرفية نفسها");
  }
}
