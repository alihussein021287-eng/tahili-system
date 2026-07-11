"use client";
import { useFormStatus } from "react-dom";

export function SubmitButton({ children = "حفظ", className = "btn-primary" }: { children?: React.ReactNode; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending}>
      {pending ? "جارٍ الحفظ..." : children}
    </button>
  );
}
