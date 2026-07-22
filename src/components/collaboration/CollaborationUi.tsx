import Link from "next/link";
import React from "react";
import { CollaborationHelpButton } from "@/components/collaboration/CollaborationHelpButton";
import { PageHeader } from "@/components/PageHeader";
import { PageTabs } from "@/components/Ui";

export type IconName =
  | "archive"
  | "arrow"
  | "attach"
  | "bell"
  | "chat"
  | "check"
  | "chevron"
  | "clock"
  | "close"
  | "details"
  | "download"
  | "edit"
  | "eye"
  | "file"
  | "filter"
  | "folder"
  | "grid"
  | "help"
  | "image"
  | "info"
  | "list"
  | "lock"
  | "more"
  | "move"
  | "mute"
  | "newFolder"
  | "pdf"
  | "pin"
  | "plus"
  | "rename"
  | "reply"
  | "restore"
  | "search"
  | "send"
  | "share"
  | "sort"
  | "star"
  | "trash"
  | "upload"
  | "users"
  | "warning";

const paths: Record<IconName, React.ReactNode> = {
  archive: <path d="M4 7h16M6 7v11a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7M8 4h8l2 3H6l2-3Zm2 7h4" />,
  arrow: <path d="M15 18l-6-6 6-6" />,
  attach: <path d="M8 12.5 14.5 6a3 3 0 0 1 4.2 4.2l-8 8a5 5 0 0 1-7.1-7.1l8-8" />,
  bell: <path d="M18 9a6 6 0 1 0-12 0c0 7-3 7-3 7h18s-3 0-3-7Zm-8 11h4" />,
  chat: <path d="M5 6.5A3.5 3.5 0 0 1 8.5 3h7A3.5 3.5 0 0 1 19 6.5v5A3.5 3.5 0 0 1 15.5 15H10l-5 4v-4.5A3.5 3.5 0 0 1 2 11V6.5Z" />,
  check: <path d="m5 12 4 4L19 6" />,
  chevron: <path d="m9 18 6-6-6-6" />,
  clock: <path d="M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  details: <path d="M4 6h16M4 12h16M4 18h10" />,
  download: <path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14" />,
  edit: <path d="M4 20h4L18.5 9.5a2.8 2.8 0 0 0-4-4L4 16v4Zm10-14 4 4" />,
  eye: <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />,
  file: <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Zm0 0v5h5" />,
  filter: <path d="M4 5h16l-6 7v5l-4 2v-7L4 5Z" />,
  folder: <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5V7Z" />,
  grid: <path d="M4 4h6v6H4V4Zm10 0h6v6h-6V4ZM4 14h6v6H4v-6Zm10 0h6v6h-6v-6Z" />,
  help: <path d="M12 18h.01M9.5 9a2.5 2.5 0 1 1 4 2c-.9.6-1.5 1.2-1.5 2.5M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />,
  image: <path d="M5 5h14v14H5V5Zm3 10 3-3 2 2 2-3 3 4M8 9h.01" />,
  info: <path d="M12 10v7M12 7h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />,
  list: <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />,
  lock: <path d="M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6v-9Z" />,
  more: <path d="M12 6h.01M12 12h.01M12 18h.01" />,
  move: <path d="M12 3v18M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4M8 7l4-4 4 4M8 17l4 4 4-4" />,
  mute: <path d="m3 3 18 18M5 9v6h4l5 4V9.5M16 7.5 14 9V5L9 9H7" />,
  newFolder: <path d="M3 8a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8Zm10 5h6m-3-3v6" />,
  pdf: <path d="M14 3H7a2 2 0 0 0-2 2v14h14V8l-5-5Zm0 0v5h5M8 16h1.5a1.5 1.5 0 0 0 0-3H8v5m5-5v5h1a2.5 2.5 0 0 0 0-5h-1" />,
  pin: <path d="m15 4 5 5-4 1-4 6-2-2-5 5 5-5-2-2 6-4 1-4Z" />,
  plus: <path d="M12 5v14M5 12h14" />,
  rename: <path d="M4 19h16M8 15l8.5-8.5a2.1 2.1 0 0 1 3 3L11 18H8v-3Z" />,
  reply: <path d="M10 7 5 12l5 5M5 12h10a5 5 0 0 1 5 5v1" />,
  restore: <path d="M4 12a8 8 0 1 0 2.3-5.7L4 8.5M4 4v4.5h4.5" />,
  search: <path d="m21 21-4.3-4.3M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z" />,
  send: <path d="M21 3 10 14m11-11-7 18-4-7-7-4 18-7Z" />,
  share: <path d="M8 12h8M15 6l6 6-6 6M3 6v12" />,
  sort: <path d="M7 4v16m0 0-3-3m3 3 3-3M17 20V4m0 0-3 3m3-3 3 3" />,
  star: <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9L12 3Z" />,
  trash: <path d="M4 7h16M10 11v6M14 11v6M6 7l1 14h10l1-14M9 7V4h6v3" />,
  upload: <path d="M12 15V3m0 0L8 7m4-4 4 4M5 15v4h14v-4" />,
  users: <path d="M16 19c0-2.2-2.7-4-6-4s-6 1.8-6 4M10 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm10 7c0-1.7-1.6-3.1-4-3.7M16 5a3 3 0 0 1 0 6" />,
  warning: <path d="M12 9v4m0 4h.01M10.3 4.4 2.8 18a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 4.4a2 2 0 0 0-3.4 0Z" />,
};

export function Icon({ name, className = "h-4 w-4", title }: { name: IconName; className?: string; title?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden={title ? undefined : true}>
      {title && <title>{title}</title>}
      {paths[name]}
    </svg>
  );
}

export function CollaborationTopNav({ active, unreadCount }: { active: "chats" | "files"; unreadCount: number }) {
  const tabs = [
    { key: "chats" as const, href: "/collaboration", label: "الدردشات", icon: "chat" as IconName },
    { key: "files" as const, href: "/collaboration/files", label: "الملفات", icon: "folder" as IconName },
  ];
  return (
    <div className="space-y-3">
      <PageHeader title="مركز التعاون" subtitle="دردشات وملفات العمل الداخلية" icon="□"><CollaborationHelpButton /></PageHeader>
      <PageTabs active={active} label="تبويبات مركز التعاون" tabs={tabs.map((tab) => ({ key: tab.key, href: tab.href, label: tab.label, count: tab.key === "chats" ? unreadCount : undefined }))} />
    </div>
  );
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "؟";
}

export function sizeLabel(bytes: number) {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.ceil(bytes / 1024))} KB`;
}

export function fmtDate(value: string | Date) {
  return new Intl.DateTimeFormat("ar-IQ", { dateStyle: "medium", timeZone: "Asia/Baghdad" }).format(new Date(value));
}

export function fmtTime(value: string | Date) {
  return new Intl.DateTimeFormat("ar-IQ", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Baghdad" }).format(new Date(value));
}

export function fmtDateTime(value: string | Date) {
  return new Intl.DateTimeFormat("ar-IQ", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Baghdad" }).format(new Date(value));
}

export function fileIconFor(mimeType: string, name?: string): IconName {
  const lower = `${mimeType} ${name || ""}`.toLowerCase();
  if (lower.includes("pdf")) return "pdf";
  if (mimeType.startsWith("image/")) return "image";
  if (lower.includes("folder")) return "folder";
  return "file";
}

export const scanLabel: Record<string, string> = {
  PENDING_SCAN: "قيد الفحص",
  SAFE: "آمن",
  REJECTED: "مرفوض",
  FAILED: "فشل الفحص",
};

export function scanClass(status: string) {
  if (status === "SAFE") return "badge-success";
  if (status === "PENDING_SCAN") return "badge-warning";
  return "badge-danger";
}
