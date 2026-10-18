"use client";
import { SessionProvider } from "next-auth/react";
import { ToastProvider } from "./Toast";
import { SaveWatcher } from "./SaveWatcher";
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <ToastProvider><SaveWatcher />{children}</ToastProvider>
    </SessionProvider>
  );
}
