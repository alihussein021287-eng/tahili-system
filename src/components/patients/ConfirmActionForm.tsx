"use client";

import type { ReactNode } from "react";

type ConfirmActionFormProps = {
  action: any;
  message: string;
  children: ReactNode;
};

export function ConfirmActionForm({ action, message, children }: ConfirmActionFormProps) {
  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (!window.confirm(message)) event.preventDefault();
      }}
    >
      {children}
    </form>
  );
}
