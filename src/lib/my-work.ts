export const WORK_ITEM_TYPES = [
  "task", "appointment", "queue", "stage", "referral", "plan", "session",
  "prescription", "stock", "purchase", "expense", "approval",
] as const;

export type WorkItemType = typeof WORK_ITEM_TYPES[number];
export type WorkPriority = "urgent" | "high" | "normal" | "low";
export type WorkDateFilter = "all" | "today" | "overdue" | "week";

export type WorkItem = {
  key: string;
  dedupeKey: string;
  type: WorkItemType;
  title: string;
  patientName?: string | null;
  status: string;
  priority: WorkPriority;
  assignee?: string | null;
  waitingSince: Date;
  dueAt?: Date | null;
  centerId?: number | null;
  centerName?: string | null;
  branchId?: number | null;
  branchName?: string | null;
  nextAction: string;
  href: string;
  requiredPermission: string;
};

export type WorkFilters = {
  type: WorkItemType | "all";
  status: string;
  priority: WorkPriority | "all";
  centerId: number | null;
  date: WorkDateFilter;
  page: number;
};

const PRIORITIES = new Set<WorkPriority>(["urgent", "high", "normal", "low"]);
const DATE_FILTERS = new Set<WorkDateFilter>(["all", "today", "overdue", "week"]);
const TYPE_FILTERS = new Set<WorkItemType>(WORK_ITEM_TYPES);
const MAX_PAGE = 20;

export function normalizeWorkFilters(input: Record<string, string | undefined>): WorkFilters {
  const rawPage = Number.parseInt(input.page ?? "1", 10);
  const rawCenter = Number.parseInt(input.center ?? "", 10);
  return {
    type: TYPE_FILTERS.has(input.type as WorkItemType) ? input.type as WorkItemType : "all",
    status: /^[a-z_]{1,32}$/i.test(input.status ?? "") ? input.status!.toLowerCase() : "all",
    priority: PRIORITIES.has(input.priority as WorkPriority) ? input.priority as WorkPriority : "all",
    centerId: Number.isSafeInteger(rawCenter) && rawCenter > 0 ? rawCenter : null,
    date: DATE_FILTERS.has(input.date as WorkDateFilter) ? input.date as WorkDateFilter : "all",
    page: Number.isSafeInteger(rawPage) ? Math.min(MAX_PAGE, Math.max(1, rawPage)) : 1,
  };
}

export function derivePriority(input: { now?: Date; dueAt?: Date | null; explicit?: string | null; waitingSince?: Date | null }): WorkPriority {
  const now = input.now ?? new Date();
  const explicit = input.explicit?.toUpperCase();
  if (explicit === "URGENT") return "urgent";
  if (explicit === "HIGH") return "high";
  if (explicit === "LOW") return "low";
  if (input.dueAt && input.dueAt < now) return "urgent";
  if (input.dueAt && input.dueAt.getTime() - now.getTime() <= 24 * 60 * 60 * 1000) return "high";
  if (input.waitingSince && now.getTime() - input.waitingSince.getTime() >= 3 * 24 * 60 * 60 * 1000) return "high";
  return "normal";
}

const priorityRank: Record<WorkPriority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

export function sortWorkItems(items: WorkItem[]) {
  return [...items].sort((a, b) =>
    priorityRank[a.priority] - priorityRank[b.priority]
    || (a.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER) - (b.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER)
    || a.waitingSince.getTime() - b.waitingSince.getTime()
    || a.key.localeCompare(b.key),
  );
}

export function dedupeWorkItems(items: WorkItem[]) {
  const unique = new Map<string, WorkItem>();
  for (const item of sortWorkItems(items)) {
    if (!unique.has(item.dedupeKey)) unique.set(item.dedupeKey, item);
  }
  return [...unique.values()];
}

function startOfBaghdadDay(now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Baghdad", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return new Date(Date.UTC(value("year"), value("month") - 1, value("day"), -3));
}

export function filterWorkItems(items: WorkItem[], filters: WorkFilters, now = new Date()) {
  const start = startOfBaghdadDay(now);
  const tomorrow = new Date(start.getTime() + 86_400_000);
  const week = new Date(start.getTime() + 7 * 86_400_000);
  return items.filter((item) => {
    if (filters.type !== "all" && item.type !== filters.type) return false;
    if (filters.status !== "all" && item.status.toLowerCase() !== filters.status) return false;
    if (filters.priority !== "all" && item.priority !== filters.priority) return false;
    if (filters.centerId && item.centerId !== filters.centerId) return false;
    const date = item.dueAt ?? item.waitingSince;
    if (filters.date === "today" && !(date >= start && date < tomorrow)) return false;
    if (filters.date === "overdue" && !(item.dueAt && item.dueAt < now)) return false;
    if (filters.date === "week" && !(date >= start && date < week)) return false;
    return true;
  });
}

export function paginateWorkItems(items: WorkItem[], page: number, pageSize = 20) {
  const safeSize = Math.min(50, Math.max(1, pageSize));
  const safePage = Math.min(MAX_PAGE, Math.max(1, page));
  const start = (safePage - 1) * safeSize;
  return {
    items: items.slice(start, start + safeSize),
    page: safePage,
    pageSize: safeSize,
    total: items.length,
    pageCount: Math.max(1, Math.ceil(items.length / safeSize)),
  };
}

export function waitLabel(since: Date, now = new Date()) {
  const minutes = Math.max(0, Math.floor((now.getTime() - since.getTime()) / 60_000));
  if (minutes < 60) return `${minutes} دقيقة`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ساعة`;
  return `${Math.floor(hours / 24)} يوم`;
}
