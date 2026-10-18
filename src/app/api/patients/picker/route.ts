import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { currentPerms, getApiSession } from "@/lib/access";
import { patientAdministrativeWhere, patientScopeWhere } from "@/lib/patient-access";
import { pharmacyPatientWhere } from "@/lib/pharmacy-scope";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;
const HEADERS = { "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate" };

/**
 * Server-side patient selector. The browser never receives a roster: only a bounded, stably ordered page of the patients
 * that match the typed text AND sit inside the caller's own scope (record, administrative or pharmacy relationship).
 * A patient outside the scope is never returned, whatever is typed (no cross-branch enumeration; NULL branch grants nothing).
 * Cross-branch identity lookup stays a separate, exact-identifier-only flow on the visits screen.
 */
export async function GET(request: NextRequest) {
  const { session, response } = await getApiSession();
  if (response || !session) return response!;
  const userId = (session.user as { id?: string }).id!;
  const role = (session.user as { role?: any }).role;
  const params = request.nextUrl.searchParams;
  const scope = params.get("scope") ?? "record";
  const q = (params.get("q") ?? "").trim().slice(0, 80);
  const cursor = params.get("cursor");
  const id = params.get("id");

  const actor = { userId, role, permissions: await currentPerms() };
  let scoped: Prisma.PatientWhereInput;
  if (scope === "administrative") scoped = await patientAdministrativeWhere(prisma, actor);
  else if (scope === "pharmacy") scoped = await pharmacyPatientWhere({ userId, role });
  else if (scope === "record") scoped = await patientScopeWhere(prisma, actor);
  else if (scope === "admitted") {
    // currently admitted patients inside the caller's record scope (inpatient medication doses)
    scoped = { AND: [await patientScopeWhere(prisma, actor), { admissions: { some: { status: "ADMITTED" } } }] };
  }
  else return NextResponse.json({ error: "scope" }, { status: 400, headers: HEADERS });

  const select = { id: true, fullName: true, fileNumber: true } as const;
  const label = (p: { id: string; fullName: string; fileNumber: number }) => ({ value: p.id, label: `${p.fullName} (#${p.fileNumber})` });

  // Resolve the label of an already selected patient (default values), still inside the scope.
  if (id) {
    const one = await prisma.patient.findFirst({ where: { id, archivedAt: null, AND: [scoped] }, select });
    return NextResponse.json({ items: one ? [label(one)] : [], nextCursor: null }, { headers: HEADERS });
  }

  const search: Prisma.PatientWhereInput[] = [];
  if (q) {
    search.push({ fullName: { contains: q, mode: "insensitive" } });
    if (/^\d{1,9}$/.test(q)) search.push({ fileNumber: Number(q) });
    if (/^\d{7,15}$/.test(q)) search.push({ phone: q });
  }
  const where: Prisma.PatientWhereInput = { archivedAt: null, AND: [scoped, ...(search.length ? [{ OR: search }] : [])] };
  const rows = await prisma.patient.findMany({
    where,
    select,
    orderBy: [{ fullName: "asc" }, { id: "asc" }],
    take: PAGE_SIZE + 1,
    ...(cursor ? { cursor: { id: cursor } } : {}),
  });
  const page = rows.slice(0, PAGE_SIZE);
  return NextResponse.json(
    { items: page.map(label), nextCursor: rows.length > PAGE_SIZE ? rows[PAGE_SIZE].id : null },
    { headers: HEADERS },
  );
}
