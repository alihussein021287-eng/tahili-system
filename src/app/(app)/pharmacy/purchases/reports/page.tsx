import { prisma } from "@/lib/db";
import { requirePerm, currentPerms } from "@/lib/access";
import { PageHeader } from "@/components/PageHeader";
import { PharmacyNav } from "@/components/PharmacyNav";

export const dynamic = "force-dynamic";

export default async function PurchaseReports(){
  await requirePerm("pharmacy.purchase.view"); const perms=await currentPerms();
  const [statuses, receipts, items, stock] = await Promise.all([prisma.purchaseOrder.groupBy({by:["status"],_count:{_all:true}}),prisma.purchaseReceipt.count(),prisma.purchaseOrderItem.aggregate({_sum:{orderedQuantity:true,receivedQuantity:true,rejectedQuantity:true,damagedQuantity:true,unitPrice:true}}),prisma.medication.aggregate({_sum:{quantity:true}})]);
  return <div className="space-y-5"><PageHeader title="تقارير الشراء والاستلام والمخزون" subtitle="ملخص أوامر الشراء والكميات المستلمة" icon="📊"/><PharmacyNav/><div className="grid gap-3 md:grid-cols-4"><Metric label="عمليات الاستلام" value={receipts}/><Metric label="الكمية المطلوبة" value={items._sum.orderedQuantity||0}/><Metric label="الكمية المستلمة" value={items._sum.receivedQuantity||0}/><Metric label="المخزون الحالي" value={stock._sum.quantity||0}/></div><section className="card overflow-hidden"><table className="w-full text-sm"><thead><tr><th className="th">حالة الأمر</th><th className="th">العدد</th></tr></thead><tbody>{statuses.map((row)=><tr key={row.status}><td className="td">{row.status}</td><td className="td">{row._count._all}</td></tr>)}</tbody></table></section><section className="card grid gap-3 p-5 md:grid-cols-3"><Metric label="المرفوض" value={items._sum.rejectedQuantity||0}/><Metric label="التالف" value={items._sum.damagedQuantity||0}/>{perms.has("pharmacy.purchase.prices")?<Metric label="إجمالي أسعار الوحدات" value={Number(items._sum.unitPrice||0)}/>:null}</section></div>;
}
function Metric({label,value}:{label:string;value:number}){return <div className="card p-4"><div className="text-2xl font-bold text-brand-700">{new Intl.NumberFormat("ar-IQ").format(value)}</div><div className="text-sm text-gray-600">{label}</div></div>}
