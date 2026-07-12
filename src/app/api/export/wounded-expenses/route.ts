import { prisma } from "@/lib/db";
import { getApiSession } from "@/lib/access";
import { checkApiPermission,apiPermissionResponse } from "@/lib/api-permissions";
import { fmtDate } from "@/lib/labels";

const esc=(value:unknown)=>{const text=value==null?"":String(value);return /[",\n]/.test(text)?`"${text.replace(/"/g,'""')}"`:text};

export async function GET(req:Request){
  const {session,response}=await getApiSession();
  if(response||!session)return response!;
  const userId=(session.user as any).id;
  const role=(session.user as any).role;
  for(const key of ["expenses.reports","expenses.amounts"]){
    const permission=await checkApiPermission(userId,role,key);
    if(permission.allowed===false)return apiPermissionResponse(permission);
  }
  const params=new URL(req.url).searchParams;
  const where:any={};
  if(params.get("from")||params.get("to"))where.requestDate={gte:params.get("from")?new Date(params.get("from")!):undefined,lte:params.get("to")?new Date(`${params.get("to")}T23:59:59`):undefined};
  if(params.get("patientId"))where.patientId=params.get("patientId");
  if(params.get("type"))where.expenseType={contains:params.get("type"),mode:"insensitive"};
  if(params.get("status"))where.status=params.get("status");
  if(params.get("entity"))where.beneficiaryEntity={contains:params.get("entity"),mode:"insensitive"};
  const rows=await prisma.woundedExpense.findMany({where,include:{patient:true},orderBy:{requestDate:"desc"}});
  const data=[["رقم السند","التاريخ","المراجع","المستفيد","الجهة","النوع","الحالة","المبلغ","العملة","سبب الصرف"],...rows.map((row)=>[row.voucherNo,fmtDate(row.requestDate),row.patient.fullName,row.beneficiary,row.beneficiaryEntity,row.expenseType,row.status,row.amount,row.currency,row.reason])];
  await prisma.auditLog.create({data:{userId,action:"UPDATE",tableName:"wounded_expenses",recordId:"REPORT",newValue:{exported:true,count:rows.length}}});
  const csv="\uFEFFsep=,\r\n"+data.map((row)=>row.map(esc).join(",")).join("\r\n");
  return new Response(csv,{headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":`attachment; filename="wounded-expenses-${new Date().toISOString().slice(0,10)}.csv"`,"Cache-Control":"no-store"}});
}
