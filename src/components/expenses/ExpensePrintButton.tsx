"use client";
import { recordExpensePrint } from "@/app/(app)/finance/expenses/actions";
export function ExpensePrintButton({id}:{id:string}){return <button className="btn-primary" onClick={async()=>{await recordExpensePrint(id);window.print()}}>طباعة سند الصرف</button>}
