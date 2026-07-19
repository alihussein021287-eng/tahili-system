import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/PageHeader";
import { currentPerms } from "@/lib/access";
import { centerActor } from "@/lib/center-access";
import { CENTER_SPACES, resolveCenter, SERVICE_LABELS } from "@/lib/center-workspaces";
import { saveCenterResource, setCenterResourceStatus } from "../../actions";
import { fmtDateTime } from "@/lib/labels";

export const dynamic = "force-dynamic";

export default async function ResourcesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!(slug in CENTER_SPACES)) notFound();
  const { config, center } = await resolveCenter(prisma, slug as keyof typeof CENTER_SPACES);
  if (!center) notFound();
  await centerActor(center.id);
  const perms = await currentPerms();
  const [resources, rooms, halls, bookings] = await Promise.all([
    prisma.centerResource.findMany({ where: { centerId: center.id }, orderBy: { name: "asc" } }),
    prisma.room.findMany({ orderBy: { name: "asc" } }),
    prisma.therapyHall.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.centerSession.findMany({ where: { centerId: center.id, scheduledAt: { gte: new Date() } }, include: { patient: true, resource: true, assignedTo: true }, orderBy: { scheduledAt: "asc" }, take: 100 }),
  ]);
  const canManage = perms.has("centers.resources.manage");
  return <div className="space-y-5">
    <PageHeader title={`الموارد والحجوزات، ${config.title}`} subtitle="الأجهزة والغرف والقاعات والسعة والتوفر" icon="⚙">
      <Link href="/therapy-centers?tab=centers" className="btn-ghost bg-white text-brand-700">لوحة المسار العلاجي والمراكز</Link>
    </PageHeader>
    {canManage ? <form action={saveCenterResource.bind(null, center.id)} className="card grid gap-3 p-5 md:grid-cols-3" autoComplete="off">
      <h2 className="font-bold md:col-span-3">إضافة أو تحديث مورد</h2>
      <label className="label">الاسم<input name="name" className="input mt-1" required /></label>
      <label className="label">النوع<select name="type" className="input mt-1"><option value="DEVICE">جهاز</option><option value="ROOM">غرفة</option><option value="HALL">قاعة</option></select></label>
      <label className="label">الخدمة<select name="serviceType" className="input mt-1"><option value="">كل الخدمات</option>{config.services.map((service)=><option key={service} value={service}>{SERVICE_LABELS[service]}</option>)}</select></label>
      <label className="label">السعة<input name="capacity" type="number" min="1" defaultValue="1" className="input mt-1" /></label>
      <label className="label">ربط بغرفة موجودة<select name="roomId" className="input mt-1"><option value="">غير مرتبط</option>{rooms.map((room)=><option key={room.id} value={room.id}>{room.name}</option>)}</select></label>
      <label className="label">ربط بقاعة موجودة<select name="therapyHallId" className="input mt-1"><option value="">غير مرتبط</option>{halls.map((hall)=><option key={hall.id} value={hall.id}>{hall.name}</option>)}</select></label>
      <div className="md:col-span-3"><button className="btn-primary">حفظ المورد</button></div>
    </form> : null}
    <section className="card overflow-hidden"><h2 className="border-b p-4 font-bold">الموارد</h2><table className="w-full text-sm"><thead><tr><th className="th">المورد</th><th className="th">النوع</th><th className="th">الخدمة</th><th className="th">السعة</th><th className="th">الحالة</th></tr></thead><tbody>{resources.map((resource)=><tr key={resource.id}><td className="td">{resource.name}</td><td className="td">{resource.type}</td><td className="td">{resource.serviceType ? SERVICE_LABELS[resource.serviceType] : "كل الخدمات"}</td><td className="td">{resource.capacity}</td><td className="td"><div>{resource.status}</div>{canManage ? <div className="mt-1 flex flex-wrap gap-2"><form action={setCenterResourceStatus.bind(null,center.id,resource.id,"AVAILABLE")}><button className="text-xs text-emerald-700 hover:underline">متاح</button></form><form action={setCenterResourceStatus.bind(null,center.id,resource.id,"MAINTENANCE")}><button className="text-xs text-amber-700 hover:underline">صيانة</button></form><form action={setCenterResourceStatus.bind(null,center.id,resource.id,"OUT_OF_SERVICE")}><button className="text-xs text-red-700 hover:underline">خارج الخدمة</button></form></div> : null}</td></tr>)}</tbody></table></section>
    <section className="card overflow-hidden"><h2 className="border-b p-4 font-bold">الحجوزات القادمة</h2><table className="w-full text-sm"><thead><tr><th className="th">الموعد</th><th className="th">المراجع</th><th className="th">المورد</th><th className="th">المسؤول</th></tr></thead><tbody>{bookings.map((booking)=><tr key={booking.id}><td className="td">{fmtDateTime(booking.scheduledAt)}</td><td className="td">{booking.patient.fullName}</td><td className="td">{booking.resource?.name || "—"}</td><td className="td">{booking.assignedTo?.fullName || "—"}</td></tr>)}</tbody></table></section>
  </div>;
}
