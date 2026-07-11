"use client";
import { signOut } from "next-auth/react";
import { ROLE_LABELS } from "@/lib/permissions";

export function Topbar({ name, role }: { name: string; role?: any }) {
  return (
    <header className="no-print flex items-center justify-between border-b border-gray-200 bg-white px-6 py-3">
      <div className="text-sm text-gray-500">أهلاً، <span className="font-medium text-gray-800">{name}</span>
        <span className="badge-brand mr-2">{ROLE_LABELS[role as keyof typeof ROLE_LABELS] ?? ""}</span>
      </div>
      <button className="btn-ghost" onClick={() => signOut({ callbackUrl: "/login" })}>تسجيل الخروج</button>
    </header>
  );
}
