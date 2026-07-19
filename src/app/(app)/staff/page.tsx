import Link from "next/link";
import { redirect } from "next/navigation";
import type { UserRole } from "@prisma/client";
import { Combobox } from "@/components/Combobox";
import { PageHeader } from "@/components/PageHeader";
import { AdminIntro, AdminSection, AdminSectionTabs, StatCard } from "@/components/AdminPageSections";
import { currentPerms, requireSession } from "@/lib/access";
import { prisma } from "@/lib/db";
import { fmtDate, fmtDateTime, fmtTime } from "@/lib/labels";
import { canManageUsers, ROLE_LABELS } from "@/lib/permissions";
import { checkIn, checkOut, deleteAttendance } from "../attendance/actions";
import { addShift, deleteLeave, deleteShift, requestLeave, setLeaveStatus } from "../shifts/actions";
import { completeTask, createTask, deleteTask, reopenTask, startTask } from "../tasks/actions";

export const dynamic = "force-dynamic";

type StaffTab = "overview" | "employees" | "attendance" | "shifts" | "leaves" | "tasks" | "reports";

const STAFF_TABS: { key: StaffTab; label: string; title: string; description: string; perms: string[] }[] = [
  { key: "overview", label: "نظرة عامة", title: "لوحة الموظفين والمهام", description: "ملخص سريع للحضور، الحسابات، المناوبات، الإجازات، والمهام المفتوحة.", perms: ["users.view", "attendance.view", "shifts.view", "tasks.view"] },
  { key: "employees", label: "الموظفون", title: "الموظفون والحسابات", description: "عرض حسابات الموظفين مع فلاتر الدور، القسم، الفرع، والحالة دون تعديل من هذه الصفحة.", perms: ["users.view"] },
  { key: "attendance", label: "الحضور", title: "الحضور اليومي", description: "تسجيلات الحضور والانصراف حسب اليوم، مع إظهار المناوبات والإجازات المؤثرة.", perms: ["attendance.view"] },
  { key: "shifts", label: "الدوام والشفتات", title: "الدوام والشفتات", description: "مناوبات الأسبوع أو المدى المحدد، وإضافة المناوبات لمن يملك صلاحية الإدارة.", perms: ["shifts.view"] },
  { key: "leaves", label: "الإجازات", title: "الإجازات", description: "طلبات الإجازات الحالية والقادمة، مع إجراءات القبول والرفض حسب الصلاحية.", perms: ["shifts.view"] },
  { key: "tasks", label: "المهام", title: "المهام", description: "متابعة المهام حسب الحالة، الأولوية، والمكلف، مع إبراز المتأخر منها.", perms: ["tasks.view"] },
  { key: "reports", label: "تقارير مختصرة", title: "تقارير مختصرة", description: "مؤشرات تشغيلية صغيرة من البيانات الموجودة دون إضافة حقول جديدة.", perms: ["users.view", "attendance.view", "shifts.view", "tasks.view"] },
];

const TASK_STATUS: Record<string, { label: string; cls: string }> = {
  OPEN: { label: "مفتوحة", cls: "bg-sky-50 text-sky-700" },
  IN_PROGRESS: { label: "قيد التنفيذ", cls: "bg-amber-50 text-amber-700" },
  DONE: { label: "منجزة", cls: "bg-emerald-50 text-emerald-700" },
  CANCELLED: { label: "ملغاة", cls: "bg-gray-100 text-gray-500" },
};
const TASK_PRIORITY: Record<string, { label: string; cls: string }> = {
  URGENT: { label: "عاجلة", cls: "bg-red-100 text-red-700" },
  HIGH: { label: "مهمة", cls: "bg-orange-100 text-orange-700" },
  NORMAL: { label: "عادية", cls: "bg-gray-100 text-gray-600" },
  LOW: { label: "منخفضة", cls: "bg-slate-100 text-slate-500" },
};
const SHIFT_LABELS: Record<string, string> = { MORNING: "صباحية", EVENING: "مسائية", NIGHT: "ليلية", FULL: "دوام كامل" };
const LEAVE_TYPES: Record<string, string> = { ANNUAL: "اعتيادية", SICK: "مرضية", EMERGENCY: "اضطرارية", UNPAID: "بدون راتب", OTHER: "أخرى" };
const LEAVE_STATUS: Record<string, { label: string; cls: string }> = {
  PENDING: { label: "قيد الموافقة", cls: "bg-amber-50 text-amber-700" },
  APPROVED: { label: "مقبولة", cls: "bg-emerald-50 text-emerald-700" },
  REJECTED: { label: "مرفوضة", cls: "bg-red-50 text-red-700" },
};

function hasAny(perms: Set<string>, keys: string[]) {
  return keys.some((key) => perms.has(key));
}

function normalizeTab(raw: string | undefined, visible: typeof STAFF_TABS): StaffTab {
  return (visible.some((tab) => tab.key === raw) ? raw : visible[0]?.key) as StaffTab;
}

function tabHref(key: StaffTab) {
  return `/staff?tab=${key}`;
}

function localDateInput(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function dateAtStart(value: string | undefined, fallback: Date) {
  if (!value) return fallback;
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isFinite(parsed.getTime()) ? parsed : fallback;
}

function nextDay(date: Date) {
  return new Date(date.getTime() + 86400000);
}

function savedMessage(saved?: string) {
  return saved ? <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{saved}</div> : null;
}

function optionEntries(record: Record<string, string>) {
  return Object.entries(record).map(([value, label]) => ({ value, label }));
}

export default async function StaffPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  const sp = await searchParams;
  const perms = await currentPerms();
  const role = (session.user as any)?.role as UserRole;
  const uid = (session.user as any)?.id as string;
  const canUserAdmin = canManageUsers(role);
  const canUsers = perms.has("users.view");
  const canAttendance = perms.has("attendance.view");
  const canAttendanceManage = perms.has("attendance.manage");
  const canShifts = perms.has("shifts.view");
  const canShiftManage = perms.has("shifts.manage");
  const canLeaveApprove = perms.has("shifts.approve");
  const canTasks = perms.has("tasks.view");
  const canTaskCreate = perms.has("tasks.create");
  const canTaskComplete = perms.has("tasks.complete");
  const canTaskDelete = perms.has("tasks.delete") && role === "ADMIN";

  const visibleTabs = STAFF_TABS.filter((tab) => {
    if (tab.key === "employees") return canUsers;
    return hasAny(perms, tab.perms);
  });
  if (!visibleTabs.length) redirect("/");
  const activeTab = normalizeTab(sp.tab, visibleTabs);
  const requestedTab = sp.tab && STAFF_TABS.some((tab) => tab.key === sp.tab) ? sp.tab : activeTab;
  if (requestedTab !== activeTab) redirect(tabHref(activeTab));

  const today = dateAtStart(undefined, new Date(new Date().toDateString()));
  const attendanceDate = dateAtStart(sp.date, today);
  const attendanceEnd = nextDay(attendanceDate);
  const weekStart = dateAtStart(sp.from, today);
  const weekEnd = dateAtStart(sp.to, new Date(today.getTime() + 7 * 86400000));
  const shiftEnd = nextDay(weekEnd);
  const now = new Date();

  const userWhere: any = {};
  const userQuery = (sp.q ?? "").trim();
  if (userQuery) {
    userWhere.OR = [
      { username: { contains: userQuery, mode: "insensitive" } },
      { fullName: { contains: userQuery, mode: "insensitive" } },
      { department: { contains: userQuery, mode: "insensitive" } },
      { jobTitle: { contains: userQuery, mode: "insensitive" } },
    ];
  }
  if (sp.role) userWhere.role = sp.role;
  if (sp.userStatus === "active") userWhere.isActive = true;
  if (sp.userStatus === "disabled") userWhere.isActive = false;
  if (sp.branch) userWhere.branchId = Number(sp.branch);
  if (sp.department) userWhere.department = sp.department;

  const taskWhere: any = {};
  if (!sp.taskStatus || sp.taskStatus === "open") taskWhere.status = { in: ["OPEN", "IN_PROGRESS"] };
  else if (sp.taskStatus === "overdue") {
    taskWhere.status = { in: ["OPEN", "IN_PROGRESS"] };
    taskWhere.dueDate = { lt: now };
  } else if (sp.taskStatus !== "all") taskWhere.status = sp.taskStatus;
  if (sp.priority && sp.priority !== "all") taskWhere.priority = sp.priority;
  if (sp.assignee === "mine") taskWhere.OR = [{ assignedToId: uid }, { assignedRole: role }];
  else if (sp.assignee === "created") taskWhere.createdById = uid;
  else if (sp.assignee === "unassigned") {
    taskWhere.assignedToId = null;
    taskWhere.assignedRole = null;
  } else if (sp.assignee?.startsWith("user:")) taskWhere.assignedToId = sp.assignee.slice(5);
  else if (sp.assignee?.startsWith("role:")) taskWhere.assignedRole = sp.assignee.slice(5) as UserRole;

  const leaveWhere: any = { toDate: { gte: today } };
  if (sp.leaveStatus && sp.leaveStatus !== "all") leaveWhere.status = sp.leaveStatus;
  if (sp.leaveName) leaveWhere.name = sp.leaveName;

  const [
    branches,
    users,
    allUsers,
    totalUsers,
    activeUsers,
    disabledUsers,
    employeeRoster,
    attendanceRows,
    todayAttendance,
    todayShifts,
    leaves,
    todayLeaves,
    shifts,
    tasks,
    recentTasks,
    openTasks,
    urgentTasks,
    overdueTasks,
    patients,
  ] = await Promise.all([
    canUsers ? prisma.branch.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }) : Promise.resolve([]),
    canUsers ? prisma.user.findMany({
      where: userWhere,
      select: { id: true, username: true, fullName: true, role: true, isActive: true, department: true, jobTitle: true, lastLoginAt: true, lastSeenAt: true, branch: { select: { name: true } } },
      orderBy: [{ isActive: "desc" }, { fullName: "asc" }],
      take: 200,
    }) : Promise.resolve([]),
    canUsers || canTasks || canTaskCreate ? prisma.user.findMany({ where: { isActive: true }, select: { id: true, fullName: true, role: true, department: true }, orderBy: { fullName: "asc" }, take: 300 }) : Promise.resolve([]),
    canUsers ? prisma.user.count() : Promise.resolve(0),
    canUsers ? prisma.user.count({ where: { isActive: true } }) : Promise.resolve(0),
    canUsers ? prisma.user.count({ where: { isActive: false } }) : Promise.resolve(0),
    canAttendance || canShifts ? prisma.employee.findMany({ orderBy: { name: "asc" } }) : Promise.resolve([]),
    canAttendance ? prisma.attendance.findMany({ where: { date: { gte: attendanceDate, lt: attendanceEnd } }, orderBy: [{ checkOut: "asc" }, { checkIn: "desc" }] }) : Promise.resolve([]),
    canAttendance ? prisma.attendance.findMany({ where: { date: { gte: today, lt: nextDay(today) } }, orderBy: { checkIn: "desc" } }) : Promise.resolve([]),
    canAttendance || canShifts ? prisma.shift.findMany({ where: { date: { gte: today, lt: nextDay(today) } }, orderBy: { name: "asc" } }) : Promise.resolve([]),
    canShifts ? prisma.leave.findMany({ where: leaveWhere, orderBy: [{ status: "asc" }, { fromDate: "asc" }, { name: "asc" }], take: 200 }) : Promise.resolve([]),
    canAttendance || canShifts ? prisma.leave.findMany({ where: { status: "APPROVED", fromDate: { lte: today }, toDate: { gte: today } }, orderBy: { name: "asc" } }) : Promise.resolve([]),
    canShifts ? prisma.shift.findMany({ where: { date: { gte: weekStart, lt: shiftEnd } }, orderBy: [{ date: "asc" }, { name: "asc" }], take: 200 }) : Promise.resolve([]),
    canTasks ? prisma.task.findMany({
      where: taskWhere,
      include: { assignedTo: { select: { id: true, fullName: true } }, createdBy: { select: { fullName: true } }, patient: { select: { id: true, fullName: true, fileNumber: true } } },
      orderBy: [{ status: "asc" }, { priority: "desc" }, { dueDate: "asc" }, { updatedAt: "desc" }],
      take: 200,
    }) : Promise.resolve([]),
    canTasks ? prisma.task.findMany({
      where: { status: { in: ["OPEN", "IN_PROGRESS"] }, OR: [{ assignedToId: uid }, { assignedRole: role }] },
      include: { assignedTo: { select: { fullName: true } }, patient: { select: { id: true, fullName: true, fileNumber: true } } },
      orderBy: [{ priority: "desc" }, { dueDate: "asc" }],
      take: 8,
    }) : Promise.resolve([]),
    canTasks ? prisma.task.count({ where: { status: { in: ["OPEN", "IN_PROGRESS"] } } }) : Promise.resolve(0),
    canTasks ? prisma.task.count({ where: { status: { in: ["OPEN", "IN_PROGRESS"] }, priority: "URGENT" } }) : Promise.resolve(0),
    canTasks ? prisma.task.count({ where: { status: { in: ["OPEN", "IN_PROGRESS"] }, dueDate: { lt: now } } }) : Promise.resolve(0),
    canTaskCreate ? prisma.patient.findMany({ select: { id: true, fullName: true, fileNumber: true }, orderBy: { fullName: "asc" }, take: 300 }) : Promise.resolve([]),
  ]);

  const departments = Array.from(new Set(allUsers.map((user: any) => user.department).filter(Boolean))).sort();
  const employeeNames = Array.from(new Set([...employeeRoster.map((item: any) => item.name), ...allUsers.map((user: any) => user.fullName)].filter(Boolean))).sort();
  const presentNames = new Set(todayAttendance.map((row: any) => row.name));
  const leaveNames = new Set(todayLeaves.map((row: any) => row.name));
  const absentRoster = employeeRoster.filter((employee: any) => !presentNames.has(employee.name) && !leaveNames.has(employee.name));
  const presentNow = todayAttendance.filter((row: any) => row.checkIn && !row.checkOut).length;
  const completedToday = todayAttendance.filter((row: any) => row.checkOut).length;
  const navTabs = visibleTabs.map((tab) => ({ key: tab.key, label: tab.label, href: tabHref(tab.key) }));
  const activeInfo = STAFF_TABS.find((tab) => tab.key === activeTab)!;
  const canDeleteStaffRows = role === "ADMIN";
  const taskAssigneeOptions = [
    { value: "", label: "كل المكلفين" },
    { value: "mine", label: "مهامي" },
    { value: "created", label: "أنشأتها" },
    { value: "unassigned", label: "غير مسندة" },
    ...allUsers.map((user: any) => ({ value: `user:${user.id}`, label: `موظف: ${user.fullName}` })),
    ...Object.entries(ROLE_LABELS).map(([value, label]: any) => ({ value: `role:${value}`, label: `دور: ${label}` })),
  ];

  return (
    <div className="min-w-0 space-y-6">
      <PageHeader title="الموظفون والمهام" subtitle="صفحة جامعة للحضور، الدوام، الإجازات، والمهام" icon="🗂" />
      <AdminSectionTabs tabs={navTabs} active={activeTab} label="تبويبات الموظفين والمهام" />
      <AdminIntro title={activeInfo.title} description={activeInfo.description}>
        <div className="flex flex-wrap gap-2">
          {canUserAdmin ? <Link href="/users?tab=create" className="btn-ghost btn-sm">إضافة موظف</Link> : null}
          {canAttendanceManage ? <Link href="/staff?tab=attendance" className="btn-ghost btn-sm">تسجيل حضور</Link> : null}
          {canShiftManage ? <Link href="/staff?tab=leaves" className="btn-ghost btn-sm">طلب إجازة</Link> : null}
          {canTaskCreate ? <Link href="/staff?tab=tasks" className="btn-ghost btn-sm">إضافة مهمة</Link> : null}
        </div>
      </AdminIntro>
      {savedMessage(sp.saved)}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <StatCard label="إجمالي الموظفين" value={canUsers ? totalUsers : employeeRoster.length || "—"} />
        <StatCard label="حسابات فعالة" value={canUsers ? activeUsers : "—"} tone="text-emerald-700" />
        <StatCard label="حضور اليوم" value={canAttendance ? todayAttendance.length : "—"} tone="text-emerald-700" description={canAttendance ? `${presentNow} حاضر الآن` : undefined} />
        <StatCard label="غياب من القائمة" value={canAttendance && employeeRoster.length ? absentRoster.length : "—"} tone="text-amber-700" description={employeeRoster.length ? "حسب قائمة الحضور" : "لا توجد قائمة موظفين"} />
        <StatCard label="مهام مفتوحة" value={canTasks ? openTasks : "—"} tone="text-sky-700" />
        <StatCard label="مهام عاجلة" value={canTasks ? urgentTasks : "—"} tone="text-red-700" description={canTasks ? `${overdueTasks} متأخرة` : undefined} />
      </section>

      {activeTab === "overview" ? (
        <div className="grid gap-5 xl:grid-cols-2">
          <AdminSection id="overview-attendance" title="تشغيل اليوم" description="قراءة سريعة للحضور، المناوبات، والإجازات الحالية.">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-gray-200 p-3"><div className="text-xl font-bold text-emerald-700">{presentNow}</div><div className="text-sm text-gray-500">حاضرون الآن</div></div>
              <div className="rounded-lg border border-gray-200 p-3"><div className="text-xl font-bold text-gray-800">{completedToday}</div><div className="text-sm text-gray-500">أنهوا الدوام</div></div>
              <div className="rounded-lg border border-gray-200 p-3"><div className="text-xl font-bold text-amber-700">{todayLeaves.length}</div><div className="text-sm text-gray-500">في إجازة اليوم</div></div>
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              {todayShifts.map((shift: any) => <span key={shift.id} className="badge-brand">{shift.name} · {SHIFT_LABELS[shift.type]}</span>)}
              {todayShifts.length === 0 ? <span className="text-gray-400">لا مناوبات مجدولة اليوم.</span> : null}
            </div>
          </AdminSection>

          <AdminSection id="overview-tasks" title="مهامي القريبة" description="المهام المفتوحة المسندة لك أو لدورك.">
            <TaskRows rows={recentTasks} canComplete={canTaskComplete} canDelete={canTaskDelete} />
            {canTasks ? <Link href="/staff?tab=tasks&assignee=mine" className="btn-ghost btn-sm">عرض كل مهامي</Link> : null}
          </AdminSection>
        </div>
      ) : null}

      {activeTab === "employees" && canUsers ? (
        <AdminSection id="employees" title="قائمة الموظفين" description="فلاتر قراءة فقط؛ التعديل التفصيلي يبقى في صفحة إدارة المستخدم المحدد." className="overflow-hidden">
          <form action="/staff" className="grid gap-3 md:grid-cols-6">
            <input type="hidden" name="tab" value="employees" />
            <div className="md:col-span-2">
              <label className="label">بحث</label>
              <input name="q" defaultValue={sp.q ?? ""} className="input" placeholder="اسم، مستخدم، قسم، مسمى" />
            </div>
            <Combobox name="role" label="الدور" allowFree={false} defaultValue={sp.role ?? ""} placeholder="كل الأدوار" options={[{ value: "", label: "كل الأدوار" }, ...optionEntries(ROLE_LABELS as any)]} />
            <Combobox name="userStatus" label="الحالة" allowFree={false} defaultValue={sp.userStatus ?? ""} options={[{ value: "", label: "كل الحالات" }, { value: "active", label: "فعّال" }, { value: "disabled", label: "معطّل" }]} />
            <Combobox name="branch" label="الفرع" allowFree={false} defaultValue={sp.branch ?? ""} placeholder="كل الفروع" options={[{ value: "", label: "كل الفروع" }, ...branches.map((branch: any) => ({ value: String(branch.id), label: branch.name }))]} />
            <Combobox name="department" label="القسم" allowFree={false} defaultValue={sp.department ?? ""} placeholder="كل الأقسام" options={[{ value: "", label: "كل الأقسام" }, ...departments.map((department) => ({ value: department, label: department }))]} />
            <div className="flex flex-wrap items-end gap-2 md:col-span-6">
              <button className="btn-primary" type="submit">تصفية</button>
              <Link href="/staff?tab=employees" className="btn-ghost">مسح</Link>
              {canUserAdmin ? <Link href="/users?tab=create" className="btn-ghost">إضافة موظف</Link> : null}
            </div>
          </form>
          <div className="-mx-5 -mb-5 overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr><th className="th">المستخدم</th><th className="th">الاسم</th><th className="th">الدور</th><th className="th">القسم/الفرع</th><th className="th">الحالة</th><th className="th">آخر نشاط</th><th className="th">إجراءات</th></tr></thead>
              <tbody>
                {users.map((user: any) => (
                  <tr key={user.id} className="hover:bg-gray-50">
                    <td className="td font-mono text-xs">{user.username}</td>
                    <td className="td"><Link href={`/users/${user.id}`} className="font-medium text-brand-700 hover:underline">{user.fullName}</Link>{user.jobTitle ? <div className="text-xs text-gray-400">{user.jobTitle}</div> : null}</td>
                    <td className="td">{ROLE_LABELS[user.role as keyof typeof ROLE_LABELS]}</td>
                    <td className="td"><div>{user.department || "—"}</div><div className="text-xs text-gray-400">{user.branch?.name || "بدون فرع"}</div></td>
                    <td className="td">{user.isActive ? <span className="badge-success">فعّال</span> : <span className="badge-danger">معطّل</span>}</td>
                    <td className="td"><div>{fmtDateTime(user.lastSeenAt)}</div><div className="text-xs text-gray-400">آخر دخول: {fmtDateTime(user.lastLoginAt)}</div></td>
                    <td className="td"><Link href={`/users/${user.id}`} className="rounded bg-brand-50 px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-100">إدارة</Link></td>
                  </tr>
                ))}
                {users.length === 0 ? <tr><td className="td text-center text-gray-400" colSpan={7}>لا توجد نتائج مطابقة.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </AdminSection>
      ) : null}

      {activeTab === "attendance" && canAttendance ? (
        <div className="space-y-5">
          {canAttendanceManage ? (
            <AdminSection id="attendance-checkin" title="تسجيل حضور" description="التسجيل يستخدم قائمة الموظفين الحالية ولا يغير بيانات الحسابات.">
              <form action={checkIn} className="grid gap-3 md:grid-cols-[1fr_auto]">
                <input type="hidden" name="returnTo" value="staff" />
                <Combobox name="name" label="الموظف" required placeholder="اختر الموظف" options={employeeNames} />
                <div className="self-end"><button className="btn-primary" type="submit">تسجيل حضور</button></div>
              </form>
            </AdminSection>
          ) : null}

          <AdminSection id="attendance-table" title="سجل اليوم" description="اعرض يوم محدد، وسجل الانصراف أو الحذف حسب الصلاحية." className="overflow-hidden">
            <form action="/staff" className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="tab" value="attendance" />
              <div><label className="label">اليوم</label><input name="date" type="date" className="input" defaultValue={localDateInput(attendanceDate)} /></div>
              <button className="btn-primary" type="submit">عرض</button>
              <Link href="/attendance" className="btn-ghost">فتح الصفحة القديمة</Link>
            </form>
            <div className="-mx-5 -mb-5 overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr><th className="th">الموظف</th><th className="th">التاريخ</th><th className="th">الحضور</th><th className="th">الانصراف</th><th className="th">الحالة</th>{canAttendanceManage ? <th className="th">إجراءات</th> : null}</tr></thead>
                <tbody>
                  {attendanceRows.map((row: any) => (
                    <tr key={row.id} className="hover:bg-gray-50">
                      <td className="td font-medium">{row.name}</td>
                      <td className="td">{fmtDate(row.date)}</td>
                      <td className="td">{fmtTime(row.checkIn)}</td>
                      <td className="td">{fmtTime(row.checkOut)}</td>
                      <td className="td">{row.checkOut ? <span className="badge-neutral">انصرف</span> : <span className="badge-success">حاضر</span>}</td>
                      {canAttendanceManage ? <td className="td"><div className="flex flex-wrap gap-2">{!row.checkOut ? <form action={checkOut.bind(null, row.id)}><button className="text-xs text-brand-700 hover:underline">تسجيل انصراف</button></form> : null}{canDeleteStaffRows ? <form action={deleteAttendance.bind(null, row.id)}><button className="text-xs text-red-600 hover:underline">حذف</button></form> : null}</div></td> : null}
                    </tr>
                  ))}
                  {attendanceRows.length === 0 ? <tr><td className="td text-center text-gray-400" colSpan={canAttendanceManage ? 6 : 5}>لا تسجيلات لهذا اليوم.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </AdminSection>
        </div>
      ) : null}

      {activeTab === "shifts" && canShifts ? (
        <div className="space-y-5">
          {canShiftManage ? (
            <AdminSection id="shift-create" title="إضافة مناوبة" description="إضافة مناوبة مرتبطة باسم موظف وتاريخ فقط، حسب النموذج الحالي.">
              <form action={addShift} className="grid gap-3 md:grid-cols-5">
                <input type="hidden" name="returnTo" value="staff" />
                <Combobox name="name" label="الموظف" allowFree options={employeeNames} required />
                <div><label className="label">التاريخ</label><input name="date" type="date" className="input" required /></div>
                <Combobox name="type" label="النوع" allowFree={false} defaultValue="MORNING" options={optionEntries(SHIFT_LABELS)} />
                <div><label className="label">من</label><input name="startTime" type="time" className="input" /></div>
                <div><label className="label">إلى</label><input name="endTime" type="time" className="input" /></div>
                <div className="md:col-span-5"><button className="btn-primary" type="submit">إضافة المناوبة</button></div>
              </form>
            </AdminSection>
          ) : null}

          <AdminSection id="shifts-table" title="مناوبات المدى" description="الافتراضي يعرض الأسبوع الحالي والقادم." className="overflow-hidden">
            <form action="/staff" className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="tab" value="shifts" />
              <div><label className="label">من</label><input name="from" type="date" className="input" defaultValue={localDateInput(weekStart)} /></div>
              <div><label className="label">إلى</label><input name="to" type="date" className="input" defaultValue={localDateInput(weekEnd)} /></div>
              <button className="btn-primary" type="submit">عرض</button>
              <Link href="/shifts" className="btn-ghost">فتح الصفحة القديمة</Link>
            </form>
            <div className="-mx-5 -mb-5 overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr><th className="th">التاريخ</th><th className="th">الموظف</th><th className="th">النوع</th><th className="th">التوقيت</th>{canShiftManage ? <th className="th">إجراءات</th> : null}</tr></thead>
                <tbody>
                  {shifts.map((shift: any) => (
                    <tr key={shift.id} className="hover:bg-gray-50">
                      <td className="td">{fmtDate(shift.date)}</td>
                      <td className="td font-medium">{shift.name}</td>
                      <td className="td">{SHIFT_LABELS[shift.type]}</td>
                      <td className="td">{shift.startTime || "—"}{shift.endTime ? ` - ${shift.endTime}` : ""}</td>
                      {canShiftManage ? <td className="td">{canDeleteStaffRows ? <form action={deleteShift.bind(null, shift.id)}><button className="text-xs text-red-600 hover:underline">حذف</button></form> : null}</td> : null}
                    </tr>
                  ))}
                  {shifts.length === 0 ? <tr><td className="td text-center text-gray-400" colSpan={canShiftManage ? 5 : 4}>لا مناوبات في هذا المدى.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </AdminSection>
        </div>
      ) : null}

      {activeTab === "leaves" && canShifts ? (
        <div className="space-y-5">
          {canShiftManage ? (
            <AdminSection id="leave-request" title="طلب إجازة" description="يسجل الطلب في جدول الإجازات الحالي، ثم ينتظر القبول إذا لزم.">
              <form action={requestLeave} className="grid gap-3 md:grid-cols-5">
                <input type="hidden" name="returnTo" value="staff" />
                <Combobox name="name" label="الموظف" allowFree options={employeeNames} required />
                <Combobox name="type" label="النوع" allowFree={false} defaultValue="ANNUAL" options={optionEntries(LEAVE_TYPES)} />
                <div><label className="label">من تاريخ</label><input name="fromDate" type="date" className="input" required /></div>
                <div><label className="label">إلى تاريخ</label><input name="toDate" type="date" className="input" required /></div>
                <div><label className="label">السبب</label><input name="reason" className="input" /></div>
                <div className="md:col-span-5"><button className="btn-primary" type="submit">تقديم الطلب</button></div>
              </form>
            </AdminSection>
          ) : null}

          <AdminSection id="leaves-table" title="الإجازات الحالية والقادمة" description="فلترة حسب الحالة أو الموظف، مع إجراءات الموافقة للصلاحيات المناسبة." className="overflow-hidden">
            <form action="/staff" className="grid gap-3 md:grid-cols-4">
              <input type="hidden" name="tab" value="leaves" />
              <Combobox name="leaveStatus" label="الحالة" allowFree={false} defaultValue={sp.leaveStatus ?? "all"} options={[{ value: "all", label: "كل الحالات" }, ...Object.entries(LEAVE_STATUS).map(([value, item]) => ({ value, label: item.label }))]} />
              <Combobox name="leaveName" label="الموظف" allowFree={false} defaultValue={sp.leaveName ?? ""} placeholder="كل الموظفين" options={[{ value: "", label: "كل الموظفين" }, ...employeeNames.map((name) => ({ value: name, label: name }))]} />
              <div className="flex items-end gap-2 md:col-span-2"><button className="btn-primary" type="submit">تصفية</button><Link href="/staff?tab=leaves" className="btn-ghost">مسح</Link></div>
            </form>
            <div className="-mx-5 -mb-5 overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr><th className="th">الموظف</th><th className="th">النوع</th><th className="th">من</th><th className="th">إلى</th><th className="th">الحالة</th><th className="th">إجراءات</th></tr></thead>
                <tbody>
                  {leaves.map((leave: any) => (
                    <tr key={leave.id} className="hover:bg-gray-50">
                      <td className="td font-medium">{leave.name}</td>
                      <td className="td">{LEAVE_TYPES[leave.type]}{leave.reason ? <div className="text-xs text-gray-400">{leave.reason}</div> : null}</td>
                      <td className="td">{fmtDate(leave.fromDate)}</td>
                      <td className="td">{fmtDate(leave.toDate)}</td>
                      <td className="td"><span className={`badge ${LEAVE_STATUS[leave.status]?.cls}`}>{LEAVE_STATUS[leave.status]?.label}</span></td>
                      <td className="td"><div className="flex flex-wrap gap-2">{canLeaveApprove && leave.status === "PENDING" ? <><form action={setLeaveStatus.bind(null, leave.id, "APPROVED")}><button className="rounded bg-emerald-600 px-2 py-1 text-xs text-white hover:bg-emerald-700">قبول</button></form><form action={setLeaveStatus.bind(null, leave.id, "REJECTED")}><button className="rounded bg-red-600 px-2 py-1 text-xs text-white hover:bg-red-700">رفض</button></form></> : null}{canDeleteStaffRows ? <form action={deleteLeave.bind(null, leave.id)}><button className="text-xs text-red-600 hover:underline">حذف</button></form> : null}</div></td>
                    </tr>
                  ))}
                  {leaves.length === 0 ? <tr><td className="td text-center text-gray-400" colSpan={6}>لا إجازات مطابقة.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </AdminSection>
        </div>
      ) : null}

      {activeTab === "tasks" && canTasks ? (
        <div className="space-y-5">
          {canTaskCreate ? (
            <AdminSection id="task-create" title="إضافة مهمة" description="الإسناد لموظف أو دور، والحقول هي نفس نموذج المهام الحالي.">
              <form action={createTask} className="grid gap-3 md:grid-cols-3">
                <input type="hidden" name="returnTo" value="staff" />
                <div className="md:col-span-2"><label className="label">عنوان المهمة *</label><input name="title" className="input" required /></div>
                <Combobox name="priority" label="الأولوية" allowFree={false} defaultValue="NORMAL" options={Object.entries(TASK_PRIORITY).map(([value, item]) => ({ value, label: item.label }))} />
                <div className="md:col-span-3"><label className="label">التفاصيل</label><textarea name="description" className="input" rows={2} /></div>
                <Combobox name="assignedToId" label="إسناد لموظف" allowFree={false} placeholder="بدون" options={allUsers.map((user: any) => ({ value: user.id, label: user.fullName }))} />
                <Combobox name="assignedRole" label="أو دور كامل" allowFree={false} placeholder="بدون" options={optionEntries(ROLE_LABELS as any)} />
                <Combobox name="patientId" label="مراجع مرتبط" allowFree={false} placeholder="بدون" options={patients.map((patient: any) => ({ value: patient.id, label: `${patient.fullName}${patient.fileNumber ? ` #${patient.fileNumber}` : ""}` }))} />
                <div><label className="label">موعد الاستحقاق</label><input name="dueDate" type="date" className="input" /></div>
                <div className="flex items-end md:col-span-2"><button className="btn-primary" type="submit">إضافة المهمة</button></div>
              </form>
            </AdminSection>
          ) : null}

          <AdminSection id="tasks-table" title="قائمة المهام" description="تظهر المهام المتأخرة بخلفية خفيفة وإشارة واضحة." className="overflow-hidden">
            <form action="/staff" className="grid gap-3 md:grid-cols-5">
              <input type="hidden" name="tab" value="tasks" />
              <Combobox name="taskStatus" label="الحالة" allowFree={false} defaultValue={sp.taskStatus ?? "open"} options={[{ value: "open", label: "مفتوحة" }, { value: "overdue", label: "متأخرة" }, { value: "all", label: "كل الحالات" }, ...Object.entries(TASK_STATUS).map(([value, item]) => ({ value, label: item.label }))]} />
              <Combobox name="priority" label="الأولوية" allowFree={false} defaultValue={sp.priority ?? "all"} options={[{ value: "all", label: "كل الأولويات" }, ...Object.entries(TASK_PRIORITY).map(([value, item]) => ({ value, label: item.label }))]} />
              <Combobox name="assignee" label="المكلف" allowFree={false} defaultValue={sp.assignee ?? ""} options={taskAssigneeOptions} />
              <div className="flex items-end gap-2 md:col-span-2"><button className="btn-primary" type="submit">تصفية</button><Link href="/staff?tab=tasks" className="btn-ghost">مسح</Link><Link href="/tasks" className="btn-ghost">فتح الصفحة القديمة</Link></div>
            </form>
            <TaskRows rows={tasks} canComplete={canTaskComplete} canDelete={canTaskDelete} />
          </AdminSection>
        </div>
      ) : null}

      {activeTab === "reports" ? (
        <div className="grid gap-5 xl:grid-cols-2">
          <AdminSection id="report-staff" title="توزيع الموظفين" description="يعتمد على القسم المسجل في حسابات المستخدمين.">
            {departments.length ? (
              <div className="space-y-2 text-sm">
                {departments.map((department) => {
                  const count = allUsers.filter((user: any) => user.department === department).length;
                  return <div key={department} className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2"><span>{department}</span><span className="badge-neutral">{count}</span></div>;
                })}
              </div>
            ) : <div className="text-sm text-gray-400">لا توجد أقسام مسجلة في الحسابات.</div>}
          </AdminSection>
          <AdminSection id="report-work" title="مؤشرات العمل" description="ملخص من الحضور والمهام والإجازات الحالية.">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-gray-200 p-3"><div className="text-xl font-bold text-sky-700">{openTasks || "—"}</div><div className="text-sm text-gray-500">مهام مفتوحة</div></div>
              <div className="rounded-lg border border-gray-200 p-3"><div className="text-xl font-bold text-red-700">{overdueTasks || "—"}</div><div className="text-sm text-gray-500">مهام متأخرة</div></div>
              <div className="rounded-lg border border-gray-200 p-3"><div className="text-xl font-bold text-emerald-700">{todayAttendance.length || "—"}</div><div className="text-sm text-gray-500">حضور اليوم</div></div>
              <div className="rounded-lg border border-gray-200 p-3"><div className="text-xl font-bold text-amber-700">{todayLeaves.length || "—"}</div><div className="text-sm text-gray-500">إجازات اليوم</div></div>
            </div>
          </AdminSection>
        </div>
      ) : null}
    </div>
  );
}

function TaskRows({ rows, canComplete, canDelete }: { rows: any[]; canComplete: boolean; canDelete: boolean }) {
  if (!rows.length) return <div className="rounded-lg border border-gray-100 bg-gray-50 px-4 py-6 text-center text-sm text-gray-400">لا توجد مهام مطابقة.</div>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr><th className="th">الأولوية</th><th className="th">المهمة</th><th className="th">المكلف</th><th className="th">الاستحقاق</th><th className="th">آخر نشاط</th><th className="th">إجراءات</th></tr></thead>
        <tbody>
          {rows.map((task) => {
            const overdue = task.dueDate && new Date(task.dueDate) < new Date() && task.status !== "DONE";
            return (
              <tr key={task.id} className={`hover:bg-gray-50 ${overdue ? "bg-red-50/40" : ""}`}>
                <td className="td"><span className={`badge ${TASK_PRIORITY[task.priority]?.cls}`}>{TASK_PRIORITY[task.priority]?.label}</span></td>
                <td className="td min-w-[220px]">
                  <div className="font-medium text-gray-800">{task.title}</div>
                  {task.description ? <div className="max-w-md truncate text-xs text-gray-500">{task.description}</div> : null}
                  {task.patient ? <Link href={`/patients/${task.patient.id}`} className="text-xs text-brand-700 hover:underline">{task.patient.fullName}{task.patient.fileNumber ? ` #${task.patient.fileNumber}` : ""}</Link> : null}
                </td>
                <td className="td">{task.assignedTo?.fullName || (task.assignedRole ? ROLE_LABELS[task.assignedRole as keyof typeof ROLE_LABELS] : "غير مسندة")}<div className="text-xs text-gray-400">{task.createdBy?.fullName ? `من: ${task.createdBy.fullName}` : ""}</div></td>
                <td className={`td ${overdue ? "font-semibold text-red-700" : ""}`}>{fmtDate(task.dueDate)}{overdue ? <div className="text-xs">متأخرة</div> : null}</td>
                <td className="td"><span className={`badge ${TASK_STATUS[task.status]?.cls}`}>{TASK_STATUS[task.status]?.label}</span><div className="mt-1 text-xs text-gray-400">{fmtDateTime(task.updatedAt)}</div></td>
                <td className="td"><div className="flex flex-wrap gap-2">{canComplete && task.status === "OPEN" ? <form action={startTask.bind(null, task.id)}><button className="rounded-lg bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700 hover:bg-amber-100">بدء</button></form> : null}{canComplete && task.status !== "DONE" ? <form action={completeTask.bind(null, task.id)}><button className="rounded-lg bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-700">إنجاز</button></form> : null}{canComplete && task.status === "DONE" ? <form action={reopenTask.bind(null, task.id)}><button className="rounded-lg bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-200">إعادة فتح</button></form> : null}{canDelete ? <form action={deleteTask.bind(null, task.id)}><button className="text-xs text-red-600 hover:underline">حذف</button></form> : null}</div></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
