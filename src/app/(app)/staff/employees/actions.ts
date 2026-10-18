"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { currentActor } from "@/lib/data-center/access";
import { confirmLink, EmployeeDenied, stageAccount, updateEmployee, type EmployeePatch } from "@/lib/employees/service";

const here = (id: number, q: Record<string, string>) => `/staff/employees/${id}?${new URLSearchParams(q).toString()}`;
const str = (fd: FormData, k: string) => fd.get(k)?.toString() ?? "";

async function actorOrLogin() {
  const actor = await currentActor();
  if (!actor) redirect("/login");
  return actor;
}

export async function updateEmployeeAction(id: number, fd: FormData) {
  const actor = await actorOrLogin();
  const patch: EmployeePatch = { name: str(fd, "name"), job: str(fd, "job"), department: str(fd, "department"), specialty: str(fd, "specialty"), capacity: str(fd, "capacity"), phone: str(fd, "phone"), notes: str(fd, "notes"), category: str(fd, "category"), attendanceRequired: str(fd, "attendanceRequired") as EmployeePatch["attendanceRequired"] };
  if (fd.has("branchId")) patch.branchId = str(fd, "branchId") ? Number(str(fd, "branchId")) : null;
  let q: Record<string, string>;
  try {
    const r = await updateEmployee(prisma, actor, id, patch);
    void r; q = { saved: "1" }; // the global Toast shows the confirmation and cleans the URL
  } catch (e) {
    if (!(e instanceof EmployeeDenied)) throw e;
    q = { err: e.message };
  }
  revalidatePath("/staff/employees");
  redirect(here(id, q));
}

export async function confirmLinkAction(id: number, fd: FormData) {
  const actor = await actorOrLogin();
  let q: Record<string, string>;
  try {
    await confirmLink(prisma, actor, id, str(fd, "username"), str(fd, "note"));
    q = { linked: "1" };
  } catch (e) {
    if (!(e instanceof EmployeeDenied)) throw e;
    q = { err: e.message };
  }
  revalidatePath("/staff/employees");
  redirect(here(id, q));
}

export async function stageAccountAction(id: number, fd: FormData) {
  const actor = await actorOrLogin();
  const centerRaw = str(fd, "centerId");
  let q: Record<string, string>;
  try {
    const r = await stageAccount(prisma, actor, id, { username: str(fd, "username"), role: str(fd, "role"), centerId: centerRaw ? Number(centerRaw) : null });
    q = { staged: "1", ...(r.warnings.length ? { warn: r.warnings.join("؛ ") } : {}) };
  } catch (e) {
    if (!(e instanceof EmployeeDenied)) throw e;
    q = { err: e.message };
  }
  revalidatePath("/staff/employees");
  redirect(here(id, q));
}
