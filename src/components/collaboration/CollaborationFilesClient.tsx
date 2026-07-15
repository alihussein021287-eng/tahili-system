"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  createFolderAction,
  deleteFileAction,
  linkPatientAction,
  permanentDeleteFileAction,
  restoreFileAction,
  revokeShareAction,
  shareFileAction,
  toggleFavoriteAction,
  transferOwnerAction,
  updateFileAction,
  uploadVersionAction,
} from "@/app/(app)/collaboration/actions";
import { Icon, fileIconFor, fmtDateTime, scanClass, scanLabel, sizeLabel } from "@/components/collaboration/CollaborationUi";

type Actor = {
  id: string;
  role: string;
  permissions: string[];
};

type UserOption = {
  id: string;
  fullName: string;
  username: string;
};

type CenterOption = {
  id: number;
  name: string;
};

type ConversationOption = {
  id: string;
  title: string | null;
  type: string;
};

type PatientOption = {
  id: string;
  fullName: string;
  fileNumber: string | number;
};

type FolderItem = {
  id: string;
  name: string;
  parentId: string | null;
  department?: string | null;
  centerId?: number | null;
};

type ShareItem = {
  id: string;
  targetType: string;
  shareKey: string;
  canEdit: boolean;
  targetUser?: { fullName: string } | null;
  targetConversation?: { title: string | null } | null;
  targetCenter?: { name: string } | null;
  targetDepartment?: string | null;
};

type FileItem = {
  id: string;
  originalName: string;
  displayName: string;
  description: string | null;
  mimeType: string;
  size: number;
  accessLevel: string;
  scanStatus: string;
  currentVersion: number;
  ownerId: string;
  folderId: string | null;
  conversationId: string | null;
  department: string | null;
  centerId: number | null;
  patientId: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  owner: { fullName: string };
  center?: { name: string } | null;
  folder?: { name: string } | null;
  versions: {
    id: string;
    version: number;
    scanStatus: string;
    mimeType: string;
    size: number;
    createdAt: string;
    scans: { status: string; detail: string | null; createdAt: string }[];
  }[];
  shares: ShareItem[];
  favorites: { id: string }[];
  _count: { versions: number; shares: number };
};

type Props = {
  actor: Actor;
  files: FileItem[];
  folders: FolderItem[];
  users: UserOption[];
  centers: CenterOption[];
  conversations: ConversationOption[];
  patients: PatientOption[];
  filter: string;
  currentFolderId: string | null;
  totalBytes: number;
  canUpload: boolean;
  canShare: boolean;
  canDownload: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canRestore: boolean;
  canPermanentDelete: boolean;
  canAdmin: boolean;
};

type ModalName = "upload" | "folder" | "share" | "rename" | "move" | "delete" | "details" | "version" | "patient" | "owner" | null;

const filterLabels: Record<string, string> = {
  mine: "ملفاتي",
  shared: "مشترك معي",
  groups: "ملفات المجموعات",
  scoped: "ملفات القسم والمركز",
  recent: "الحديثة",
  favorites: "المفضلة",
  trash: "سلة المحذوفات",
  quarantine: "قيد الفحص والمرفوضة",
  all: "كل الملفات",
};

const sidebar = [
  { key: "mine", label: "ملفاتي", icon: "folder" as const },
  { key: "shared", label: "مشترك معي", icon: "share" as const },
  { key: "groups", label: "ملفات المجموعات", icon: "users" as const },
  { key: "scoped", label: "ملفات القسم والمركز", icon: "archive" as const },
  { key: "recent", label: "الحديثة", icon: "clock" as const },
  { key: "favorites", label: "المفضلة", icon: "star" as const },
  { key: "trash", label: "سلة المحذوفات", icon: "trash" as const },
];

function Modal({ title, open, onClose, children }: { title: string; open: boolean; onClose: () => void; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 sm:items-center" role="dialog" aria-modal="true" aria-label={title}>
      <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <h2 className="font-bold text-gray-900">{title}</h2>
          <button type="button" className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-100" onClick={onClose} aria-label="إغلاق">
            <Icon name="close" className="h-5 w-5" />
          </button>
        </div>
        <div className="max-h-[80vh] overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}

function actionAllowed(file: FileItem, actor: Actor, canAdmin: boolean) {
  return file.ownerId === actor.id || actor.role === "ADMIN" || canAdmin;
}

function shareTargetLabel(share: ShareItem) {
  if (share.targetUser) return `مستخدم: ${share.targetUser.fullName}`;
  if (share.targetConversation) return `محادثة: ${share.targetConversation.title || "محادثة مباشرة"}`;
  if (share.targetDepartment) return `قسم: ${share.targetDepartment}`;
  if (share.targetCenter) return `مركز: ${share.targetCenter.name}`;
  if (share.targetType === "ALL_STAFF") return "جميع الموظفين";
  return "مشاركة";
}

function safeScanReason(status: string) {
  if (status === "PENDING_SCAN") return "الملف قيد الفحص ولا يمكن تنزيله الآن.";
  if (status === "SAFE") return "اجتاز الفحص الأمني.";
  return "لم يجتز الملف الفحص الأمني ولا يمكن تنزيله.";
}

export function CollaborationFilesClient({
  actor,
  files,
  folders,
  users,
  centers,
  conversations,
  patients,
  filter,
  currentFolderId,
  totalBytes,
  canUpload,
  canShare,
  canDownload,
  canEdit,
  canDelete,
  canRestore,
  canPermanentDelete,
  canAdmin,
}: Props) {
  const router = useRouter();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [sortBy, setSortBy] = useState<"updated" | "name" | "size" | "status">("updated");
  const [query, setQuery] = useState("");
  const [modal, setModal] = useState<ModalName>(null);
  const [dropFiles, setDropFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; fileId: string } | null>(null);

  useEffect(() => {
    const stored = window.localStorage.getItem("collaboration:file-view");
    if (stored === "grid" || stored === "list") setViewMode(stored);
  }, []);
  useEffect(() => {
    window.localStorage.setItem("collaboration:file-view", viewMode);
  }, [viewMode]);
  useEffect(() => setSelectedIds([]), [filter, currentFolderId]);
  useEffect(() => {
    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);

  const folderMap = useMemo(() => new Map(folders.map((folder) => [folder.id, folder])), [folders]);
  const selectedFiles = files.filter((file) => selectedIds.includes(file.id));
  const primaryFile = selectedFiles[0] || null;
  const currentFolder = currentFolderId ? folderMap.get(currentFolderId) || null : null;
  const breadcrumbs = useMemo(() => {
    const items: FolderItem[] = [];
    let cursor = currentFolder;
    while (cursor) {
      items.unshift(cursor);
      cursor = cursor.parentId ? folderMap.get(cursor.parentId) || null : null;
    }
    return items;
  }, [currentFolder, folderMap]);

  const canUseFolderTree = ["all", "mine", "scoped", "groups"].includes(filter);
  const visibleFolders = canUseFolderTree
    ? folders.filter((folder) => (currentFolderId ? folder.parentId === currentFolderId : !folder.parentId))
    : [];

  const visibleFiles = useMemo(() => {
    const needle = query.trim();
    return files
      .filter((file) => {
        if (filter === "groups" && !file.conversationId) return false;
        if (filter === "scoped" && !file.department && !file.centerId) return false;
        if (canUseFolderTree) {
          if (currentFolderId && file.folderId !== currentFolderId) return false;
          if (!currentFolderId && ["all", "mine", "groups", "scoped"].includes(filter) && file.folderId) return false;
        }
        if (!needle) return true;
        return [file.displayName, file.originalName, file.description, file.owner.fullName, file.mimeType].filter(Boolean).join(" ").includes(needle);
      })
      .sort((a, b) => {
        if (sortBy === "name") return a.displayName.localeCompare(b.displayName, "ar");
        if (sortBy === "size") return b.size - a.size;
        if (sortBy === "status") return a.scanStatus.localeCompare(b.scanStatus);
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      });
  }, [canUseFolderTree, currentFolderId, files, filter, query, sortBy]);

  const allSelectedVisible = visibleFiles.length > 0 && visibleFiles.every((file) => selectedIds.includes(file.id));
  const selectedCanEdit = selectedFiles.length > 0 && selectedFiles.every((file) => canEdit && actionAllowed(file, actor, canAdmin) && filter !== "trash");
  const selectedCanDelete = selectedFiles.length > 0 && selectedFiles.every((file) => canDelete && actionAllowed(file, actor, canAdmin));
  const selectedCanDownload = selectedFiles.length > 0 && selectedFiles.every((file) => file.scanStatus === "SAFE") && canDownload;
  const selectedCanShare = selectedFiles.length > 0 && selectedFiles.every((file) => file.scanStatus === "SAFE") && canShare && filter !== "trash";

  const hrefFor = (updates: Record<string, string | null>) => {
    const params = new URLSearchParams();
    params.set("filter", updates.filter ?? filter);
    const folder = Object.prototype.hasOwnProperty.call(updates, "folder") ? updates.folder : currentFolderId;
    if (folder) params.set("folder", folder);
    return `/collaboration/files?${params.toString()}`;
  };

  const selectFile = (fileId: string, event?: React.MouseEvent | React.KeyboardEvent) => {
    const additive = !!event && ("metaKey" in event ? event.metaKey || event.ctrlKey : false);
    setSelectedIds((current) => {
      if (additive) return current.includes(fileId) ? current.filter((id) => id !== fileId) : [...current, fileId];
      return [fileId];
    });
  };

  const openPreview = (file: FileItem) => {
    if (file.scanStatus !== "SAFE") {
      setSelectedIds([file.id]);
      setModal("details");
      return;
    }
    if (file.mimeType.startsWith("image/") || file.mimeType === "application/pdf") {
      window.open(`/api/collaboration/files/${file.id}/download?preview=1`, "_blank", "noopener,noreferrer");
    } else if (canDownload) {
      window.open(`/api/collaboration/files/${file.id}/download`, "_blank", "noopener,noreferrer");
    }
  };

  const downloadSelected = () => {
    selectedFiles.filter((file) => file.scanStatus === "SAFE").slice(0, 5).forEach((file) => {
      window.open(`/api/collaboration/files/${file.id}/download`, "_blank", "noopener,noreferrer");
    });
  };

  return (
    <div className="space-y-4">
      <CommandBar
        canUpload={canUpload}
        selectedCount={selectedFiles.length}
        selectedCanEdit={selectedCanEdit}
        selectedCanDelete={selectedCanDelete}
        selectedCanDownload={selectedCanDownload}
        selectedCanShare={selectedCanShare}
        filter={filter}
        viewMode={viewMode}
        sortBy={sortBy}
        query={query}
        onModal={setModal}
        onDownload={downloadSelected}
        onViewMode={setViewMode}
        onSort={setSortBy}
        onQuery={setQuery}
      />

      <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="rounded-2xl border border-gray-200 bg-white p-3 shadow-sm">
          <nav className="space-y-1" aria-label="تصنيفات الملفات">
            {sidebar.map((item) => {
              const active = filter === item.key;
              return (
                <Link key={item.key} href={hrefFor({ filter: item.key, folder: null })} className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-semibold transition ${active ? "bg-brand-50 text-brand-800" : "text-gray-600 hover:bg-gray-50"}`}>
                  <Icon name={item.icon} className="h-4 w-4" />
                  <span className="flex-1">{item.label}</span>
                </Link>
              );
            })}
          </nav>
          <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm">
            <div className="flex items-center justify-between text-gray-600">
              <span>المساحة المستخدمة</span>
              <span className="font-semibold text-gray-800">{sizeLabel(totalBytes)}</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-white">
              <div className="h-full rounded-full bg-brand-600" style={{ width: `${Math.min(100, Math.max(8, totalBytes / (1024 * 1024 * 10)))}%` }} />
            </div>
          </div>
        </aside>

        <main
          className={`min-w-0 rounded-2xl border border-gray-200 bg-white shadow-sm ${dragging ? "ring-2 ring-brand-300" : ""}`}
          onDragOver={(event) => {
            event.preventDefault();
            if (canUpload) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            if (!canUpload) return;
            const dropped = Array.from(event.dataTransfer.files || []);
            if (dropped.length) {
              setDropFiles(dropped);
              setModal("upload");
            }
          }}
        >
          <div className="border-b border-gray-200 p-4">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <Breadcrumbs filter={filter} hrefFor={hrefFor} breadcrumbs={breadcrumbs} />
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <span>{visibleFolders.length + visibleFiles.length} عنصر</span>
                {selectedFiles.length > 0 && <span className="badge-brand">{selectedFiles.length} محدد</span>}
              </div>
            </div>
          </div>

          <div className="relative min-h-[560px] p-4">
            {dragging && (
              <div className="absolute inset-4 z-20 flex items-center justify-center rounded-2xl border-2 border-dashed border-brand-300 bg-brand-50/90 text-brand-800">
                <div className="text-center">
                  <Icon name="upload" className="mx-auto h-10 w-10" />
                  <div className="mt-2 font-bold">أفلت الملفات للرفع</div>
                </div>
              </div>
            )}
            {visibleFolders.length === 0 && visibleFiles.length === 0 ? (
              <EmptyFilesState canUpload={canUpload} onUpload={() => setModal("upload")} />
            ) : viewMode === "grid" ? (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {visibleFolders.map((folder) => (
                  <FolderCard key={folder.id} folder={folder} href={hrefFor({ folder: folder.id })} />
                ))}
                {visibleFiles.map((file) => (
                  <FileCard
                    key={file.id}
                    file={file}
                    selected={selectedIds.includes(file.id)}
                    canDownload={canDownload}
                    onSelect={(event) => selectFile(file.id, event)}
                    onOpen={() => openPreview(file)}
                    onContext={(event) => {
                      event.preventDefault();
                      if (!selectedIds.includes(file.id)) setSelectedIds([file.id]);
                      setContextMenu({ x: event.clientX, y: event.clientY, fileId: file.id });
                    }}
                    onFavorite={async () => {
                      await toggleFavoriteAction(file.id);
                      router.refresh();
                    }}
                  />
                ))}
              </div>
            ) : (
              <FileList
                files={visibleFiles}
                folders={visibleFolders}
                selectedIds={selectedIds}
                allSelectedVisible={allSelectedVisible}
                hrefFor={hrefFor}
                onToggleAll={() => setSelectedIds(allSelectedVisible ? [] : visibleFiles.map((file) => file.id))}
                onSelect={selectFile}
                onOpen={openPreview}
                onContext={(event, file) => {
                  event.preventDefault();
                  if (!selectedIds.includes(file.id)) setSelectedIds([file.id]);
                  setContextMenu({ x: event.clientX, y: event.clientY, fileId: file.id });
                }}
              />
            )}
          </div>
        </main>
      </div>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          file={files.find((file) => file.id === contextMenu.fileId) || null}
          filter={filter}
          canDownload={canDownload}
          selectedCanEdit={selectedCanEdit}
          selectedCanShare={selectedCanShare}
          selectedCanDelete={selectedCanDelete}
          onModal={(name) => {
            setModal(name);
            setContextMenu(null);
          }}
          onDownload={downloadSelected}
          onPreview={(file) => openPreview(file)}
        />
      )}

      <UploadModal open={modal === "upload"} onClose={() => { setModal(null); setDropFiles([]); }} initialFiles={dropFiles} folders={folders} conversations={conversations} centers={centers} currentFolderId={currentFolderId} canAdmin={canAdmin} />
      <FolderModal open={modal === "folder"} onClose={() => setModal(null)} folders={folders} currentFolderId={currentFolderId} centers={centers} />
      <ShareModal open={modal === "share"} onClose={() => setModal(null)} files={selectedFiles} users={users} conversations={conversations} centers={centers} canAdmin={canAdmin} />
      <RenameModal open={modal === "rename"} onClose={() => setModal(null)} file={primaryFile} />
      <MoveModal open={modal === "move"} onClose={() => setModal(null)} files={selectedFiles} folders={folders} />
      <DeleteModal open={modal === "delete"} onClose={() => setModal(null)} files={selectedFiles} filter={filter} canRestore={canRestore} canPermanentDelete={canPermanentDelete} selectedCanDelete={selectedCanDelete} />
      <DetailsDrawer
        open={modal === "details"}
        onClose={() => setModal(null)}
        file={primaryFile}
        folders={folders}
        users={users}
        patients={patients}
        canEdit={!!primaryFile && canEdit && actionAllowed(primaryFile, actor, canAdmin) && filter !== "trash"}
        canDownload={canDownload}
        canAdmin={canAdmin}
      />
      <VersionModal open={modal === "version"} onClose={() => setModal(null)} file={primaryFile} />
      <PatientModal open={modal === "patient"} onClose={() => setModal(null)} file={primaryFile} patients={patients} />
      <OwnerModal open={modal === "owner"} onClose={() => setModal(null)} file={primaryFile} users={users} />
    </div>
  );
}

function CommandBar({
  canUpload,
  selectedCount,
  selectedCanEdit,
  selectedCanDelete,
  selectedCanDownload,
  selectedCanShare,
  filter,
  viewMode,
  sortBy,
  query,
  onModal,
  onDownload,
  onViewMode,
  onSort,
  onQuery,
}: {
  canUpload: boolean;
  selectedCount: number;
  selectedCanEdit: boolean;
  selectedCanDelete: boolean;
  selectedCanDownload: boolean;
  selectedCanShare: boolean;
  filter: string;
  viewMode: "grid" | "list";
  sortBy: "updated" | "name" | "size" | "status";
  query: string;
  onModal: (modal: ModalName) => void;
  onDownload: () => void;
  onViewMode: (mode: "grid" | "list") => void;
  onSort: (sort: "updated" | "name" | "size" | "status") => void;
  onQuery: (query: string) => void;
}) {
  const selectionDisabled = selectedCount === 0;
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-3 shadow-sm">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={!canUpload} onClick={() => onModal("folder")} className="btn-ghost btn-sm"><Icon name="newFolder" className="h-4 w-4" /> جديد</button>
          <button type="button" disabled={!canUpload} onClick={() => onModal("upload")} className="btn-primary btn-sm"><Icon name="upload" className="h-4 w-4" /> رفع</button>
          <button type="button" disabled={!selectedCanShare} onClick={() => onModal("share")} className="btn-ghost btn-sm"><Icon name="share" className="h-4 w-4" /> مشاركة</button>
          <button type="button" disabled={!selectedCanDownload} onClick={onDownload} className="btn-ghost btn-sm"><Icon name="download" className="h-4 w-4" /> تنزيل</button>
          <button type="button" disabled={!selectedCanEdit || selectedCount !== 1} onClick={() => onModal("rename")} className="btn-ghost btn-sm"><Icon name="rename" className="h-4 w-4" /> إعادة تسمية</button>
          <button type="button" disabled={!selectedCanEdit} onClick={() => onModal("move")} className="btn-ghost btn-sm"><Icon name="move" className="h-4 w-4" /> نقل</button>
          <button type="button" disabled={filter === "trash" ? selectionDisabled : !selectedCanDelete} onClick={() => onModal("delete")} className="btn-danger-soft btn-sm"><Icon name="trash" className="h-4 w-4" /> حذف</button>
          <button type="button" disabled={selectionDisabled || selectedCount !== 1} onClick={() => onModal("details")} className="btn-ghost btn-sm"><Icon name="details" className="h-4 w-4" /> تفاصيل</button>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="flex rounded-xl border border-gray-200 bg-white p-1">
            <button type="button" className={`flex h-9 w-9 items-center justify-center rounded-lg ${viewMode === "grid" ? "bg-brand-50 text-brand-700" : "text-gray-500 hover:bg-gray-50"}`} onClick={() => onViewMode("grid")} aria-label="عرض شبكي">
              <Icon name="grid" className="h-4 w-4" />
            </button>
            <button type="button" className={`flex h-9 w-9 items-center justify-center rounded-lg ${viewMode === "list" ? "bg-brand-50 text-brand-700" : "text-gray-500 hover:bg-gray-50"}`} onClick={() => onViewMode("list")} aria-label="عرض قائمة">
              <Icon name="list" className="h-4 w-4" />
            </button>
          </div>
          <label className="relative min-w-44">
            <span className="sr-only">ترتيب الملفات</span>
            <Icon name="sort" className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <select value={sortBy} onChange={(event) => onSort(event.target.value as typeof sortBy)} className="input pr-9">
              <option value="updated">الأحدث تعديلاً</option>
              <option value="name">الاسم</option>
              <option value="size">الحجم</option>
              <option value="status">الحالة</option>
            </select>
          </label>
          <label className="relative min-w-56">
            <span className="sr-only">بحث في الملفات</span>
            <Icon name="search" className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input value={query} onChange={(event) => onQuery(event.target.value)} className="input pr-9" placeholder="بحث..." />
          </label>
        </div>
      </div>
    </section>
  );
}

function Breadcrumbs({ filter, hrefFor, breadcrumbs }: { filter: string; hrefFor: (updates: Record<string, string | null>) => string; breadcrumbs: FolderItem[] }) {
  return (
    <nav className="flex min-w-0 flex-wrap items-center gap-1 text-sm" aria-label="مسار المجلد">
      <Link href={hrefFor({ folder: null })} className="rounded-lg px-2 py-1 font-semibold text-brand-700 hover:bg-brand-50">
        {filterLabels[filter] || "ملفاتي"}
      </Link>
      {breadcrumbs.map((folder) => (
        <React.Fragment key={folder.id}>
          <Icon name="chevron" className="h-4 w-4 text-gray-300" />
          <Link href={hrefFor({ folder: folder.id })} className="rounded-lg px-2 py-1 font-semibold text-gray-700 hover:bg-gray-50">
            {folder.name}
          </Link>
        </React.Fragment>
      ))}
    </nav>
  );
}

function FolderCard({ folder, href }: { folder: FolderItem; href: string }) {
  return (
    <Link href={href} className="group flex min-h-28 flex-col justify-between rounded-xl border border-gray-200 bg-white p-3 transition hover:border-brand-200 hover:bg-brand-50 focus:outline-none focus:ring-2 focus:ring-brand-100">
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-50 text-amber-700">
          <Icon name="folder" className="h-7 w-7" />
        </div>
        <div className="min-w-0">
          <div className="truncate font-bold text-gray-900">{folder.name}</div>
          <div className="text-xs text-gray-500">مجلد</div>
        </div>
      </div>
      <div className="text-xs text-gray-400">انقر مرتين أو اضغط Enter للفتح</div>
    </Link>
  );
}

function FileThumb({ file }: { file: FileItem }) {
  const safe = file.scanStatus === "SAFE";
  if (safe && file.mimeType.startsWith("image/")) {
    return <img src={`/api/collaboration/files/${file.id}/download?preview=1`} alt="" className="h-full w-full object-cover" loading="lazy" />;
  }
  if (safe && file.mimeType === "application/pdf") {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center bg-red-50 text-red-700">
        <Icon name="pdf" className="h-8 w-8" />
        <span className="mt-1 text-xs font-bold">PDF</span>
      </div>
    );
  }
  return (
    <div className="flex h-full w-full items-center justify-center bg-gray-50 text-gray-500">
      <Icon name={fileIconFor(file.mimeType, file.displayName)} className="h-9 w-9" />
    </div>
  );
}

function FileCard({
  file,
  selected,
  canDownload,
  onSelect,
  onOpen,
  onContext,
  onFavorite,
}: {
  file: FileItem;
  selected: boolean;
  canDownload: boolean;
  onSelect: (event: React.MouseEvent | React.KeyboardEvent) => void;
  onOpen: () => void;
  onContext: (event: React.MouseEvent) => void;
  onFavorite: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onDoubleClick={onOpen}
      onContextMenu={onContext}
      onKeyDown={(event) => {
        if (event.key === " " || event.key === "Spacebar") {
          event.preventDefault();
          onSelect(event);
        }
        if (event.key === "Enter") onOpen();
      }}
      className={`group min-w-0 rounded-xl border bg-white p-2 text-right transition focus:outline-none focus:ring-2 focus:ring-brand-100 ${selected ? "border-brand-400 bg-brand-50" : "border-gray-200 hover:border-brand-200 hover:shadow-sm"}`}
      aria-selected={selected}
    >
      <div className="relative aspect-[4/3] overflow-hidden rounded-lg border border-gray-100">
        <FileThumb file={file} />
        <button type="button" onClick={(event) => { event.stopPropagation(); onFavorite(); }} className={`absolute left-2 top-2 flex h-8 w-8 items-center justify-center rounded-lg bg-white/90 shadow-sm ${file.favorites.length ? "text-amber-600" : "text-gray-400"}`} aria-label={file.favorites.length ? "إزالة من المفضلة" : "إضافة للمفضلة"}>
          <Icon name="star" className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-3 min-w-0">
        <div className="truncate font-bold text-gray-900">{file.displayName}</div>
        <div className="mt-1 flex flex-wrap items-center gap-1">
          <span className={scanClass(file.scanStatus)}>{scanLabel[file.scanStatus] || file.scanStatus}</span>
          {file._count.shares > 0 && <span className="badge-info">مشترك</span>}
          {file.favorites.length > 0 && <span className="badge-brand">مفضل</span>}
        </div>
        <div className="mt-2 flex items-center justify-between gap-2 text-xs text-gray-500">
          <span>{sizeLabel(file.size)}</span>
          <span className="truncate">{file.owner.fullName}</span>
        </div>
        {file.scanStatus !== "SAFE" && <div className="mt-2 text-xs text-amber-700">{safeScanReason(file.scanStatus)}</div>}
        {file.scanStatus === "SAFE" && canDownload && <div className="mt-2 text-xs text-gray-400">نقرة مزدوجة للمعاينة أو التنزيل</div>}
      </div>
    </div>
  );
}

function FileList({
  files,
  folders,
  selectedIds,
  allSelectedVisible,
  hrefFor,
  onToggleAll,
  onSelect,
  onOpen,
  onContext,
}: {
  files: FileItem[];
  folders: FolderItem[];
  selectedIds: string[];
  allSelectedVisible: boolean;
  hrefFor: (updates: Record<string, string | null>) => string;
  onToggleAll: () => void;
  onSelect: (fileId: string, event?: React.MouseEvent | React.KeyboardEvent) => void;
  onOpen: (file: FileItem) => void;
  onContext: (event: React.MouseEvent, file: FileItem) => void;
}) {
  return (
    <div className="space-y-2">
      {folders.map((folder) => (
        <Link key={folder.id} href={hrefFor({ folder: folder.id })} className="flex items-center gap-3 rounded-xl border border-gray-200 p-3 hover:bg-gray-50">
          <Icon name="folder" className="h-6 w-6 text-amber-600" />
          <span className="font-semibold text-gray-900">{folder.name}</span>
        </Link>
      ))}
      <div className="hidden overflow-hidden rounded-xl border border-gray-200 md:block">
        <table className="w-full table-fixed text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="w-10 px-3 py-2 text-right"><input type="checkbox" checked={allSelectedVisible} onChange={onToggleAll} aria-label="تحديد كل الملفات" /></th>
              <th className="px-3 py-2 text-right font-semibold text-gray-500">الاسم</th>
              <th className="w-40 px-3 py-2 text-right font-semibold text-gray-500">المالك</th>
              <th className="w-28 px-3 py-2 text-right font-semibold text-gray-500">الحجم</th>
              <th className="w-36 px-3 py-2 text-right font-semibold text-gray-500">التعديل</th>
              <th className="w-32 px-3 py-2 text-right font-semibold text-gray-500">الحالة</th>
            </tr>
          </thead>
          <tbody>
            {files.map((file) => (
              <tr
                key={file.id}
                onClick={(event) => onSelect(file.id, event)}
                onDoubleClick={() => onOpen(file)}
                onContextMenu={(event) => onContext(event, file)}
                className={`cursor-default border-t border-gray-100 ${selectedIds.includes(file.id) ? "bg-brand-50" : "hover:bg-gray-50"}`}
              >
                <td className="px-3 py-3"><input type="checkbox" checked={selectedIds.includes(file.id)} onChange={(event) => onSelect(file.id, event as unknown as React.MouseEvent)} aria-label={`تحديد ${file.displayName}`} /></td>
                <td className="min-w-0 px-3 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <Icon name={fileIconFor(file.mimeType, file.displayName)} className="h-5 w-5 shrink-0 text-gray-500" />
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-gray-900">{file.displayName}</div>
                      <div className="truncate text-xs text-gray-500">{file.mimeType}</div>
                    </div>
                  </div>
                </td>
                <td className="truncate px-3 py-3 text-gray-600">{file.owner.fullName}</td>
                <td className="px-3 py-3 text-gray-600">{sizeLabel(file.size)}</td>
                <td className="px-3 py-3 text-gray-600">{fmtDateTime(file.updatedAt)}</td>
                <td className="px-3 py-3"><span className={scanClass(file.scanStatus)}>{scanLabel[file.scanStatus] || file.scanStatus}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="space-y-2 md:hidden">
        {files.map((file) => (
          <button key={file.id} type="button" onClick={(event) => onSelect(file.id, event)} onDoubleClick={() => onOpen(file)} className={`flex w-full items-center gap-3 rounded-xl border p-3 text-right ${selectedIds.includes(file.id) ? "border-brand-300 bg-brand-50" : "border-gray-200 bg-white"}`}>
            <Icon name={fileIconFor(file.mimeType, file.displayName)} className="h-6 w-6 shrink-0 text-gray-500" />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold text-gray-900">{file.displayName}</span>
              <span className="block text-xs text-gray-500">{file.owner.fullName} · {sizeLabel(file.size)}</span>
            </span>
            <span className={scanClass(file.scanStatus)}>{scanLabel[file.scanStatus] || file.scanStatus}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function EmptyFilesState({ canUpload, onUpload }: { canUpload: boolean; onUpload: () => void }) {
  return (
    <div className="flex min-h-[420px] items-center justify-center text-center">
      <div>
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-50 text-brand-700">
          <Icon name="folder" className="h-8 w-8" />
        </div>
        <h2 className="mt-4 font-bold text-gray-900">لا توجد عناصر هنا</h2>
        <p className="mt-2 text-sm text-gray-500">ارفع ملفاً أو أنشئ مجلداً للبدء ضمن هذا التصنيف.</p>
        {canUpload && <button type="button" onClick={onUpload} className="btn-primary mt-4">رفع ملف</button>}
      </div>
    </div>
  );
}

function ContextMenu({
  x,
  y,
  file,
  filter,
  canDownload,
  selectedCanEdit,
  selectedCanShare,
  selectedCanDelete,
  onModal,
  onDownload,
  onPreview,
}: {
  x: number;
  y: number;
  file: FileItem | null;
  filter: string;
  canDownload: boolean;
  selectedCanEdit: boolean;
  selectedCanShare: boolean;
  selectedCanDelete: boolean;
  onModal: (modal: ModalName) => void;
  onDownload: () => void;
  onPreview: (file: FileItem) => void;
}) {
  if (!file) return null;
  return (
    <div className="fixed z-50 w-48 rounded-xl border border-gray-200 bg-white p-1 text-sm shadow-2xl" style={{ top: y, left: x }}>
      <button type="button" className="flex w-full items-center gap-2 rounded-lg px-3 py-2 hover:bg-gray-50" onClick={() => onPreview(file)}><Icon name="eye" className="h-4 w-4" /> معاينة</button>
      <button type="button" disabled={file.scanStatus !== "SAFE" || !canDownload} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 hover:bg-gray-50 disabled:opacity-50" onClick={onDownload}><Icon name="download" className="h-4 w-4" /> تنزيل</button>
      <button type="button" disabled={!selectedCanShare} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 hover:bg-gray-50 disabled:opacity-50" onClick={() => onModal("share")}><Icon name="share" className="h-4 w-4" /> مشاركة</button>
      <button type="button" disabled={!selectedCanEdit} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 hover:bg-gray-50 disabled:opacity-50" onClick={() => onModal("rename")}><Icon name="rename" className="h-4 w-4" /> إعادة تسمية</button>
      <button type="button" className="flex w-full items-center gap-2 rounded-lg px-3 py-2 hover:bg-gray-50" onClick={() => onModal("details")}><Icon name="details" className="h-4 w-4" /> التفاصيل</button>
      <button type="button" disabled={filter !== "trash" && !selectedCanDelete} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-red-700 hover:bg-red-50 disabled:opacity-50" onClick={() => onModal("delete")}><Icon name="trash" className="h-4 w-4" /> حذف</button>
    </div>
  );
}

function UploadModal({ open, onClose, initialFiles, folders, conversations, centers, currentFolderId, canAdmin }: { open: boolean; onClose: () => void; initialFiles: File[]; folders: FolderItem[]; conversations: ConversationOption[]; centers: CenterOption[]; currentFolderId: string | null; canAdmin: boolean }) {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setFiles(initialFiles);
  }, [initialFiles, open]);

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!files.length) {
      setMessage("اختر ملفاً واحداً على الأقل.");
      return;
    }
    const form = new FormData(event.currentTarget);
    files.forEach((file) => form.append("files", file));
    if (currentFolderId && !form.get("folderId")) form.set("folderId", currentFolderId);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/collaboration/files");
    xhr.upload.onprogress = (progressEvent) => {
      if (progressEvent.lengthComputable) setProgress(Math.round((progressEvent.loaded / progressEvent.total) * 100));
    };
    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText || "{}");
        if (xhr.status >= 200 && xhr.status < 300) {
          setMessage("اكتمل الرفع. ستظهر حالة الفحص ضمن القائمة.");
          setProgress(100);
          router.refresh();
          window.setTimeout(onClose, 700);
        } else {
          setMessage(data.error || "تعذر رفع الملف.");
        }
      } catch {
        setMessage("تعذر قراءة نتيجة الرفع.");
      }
    };
    xhr.onerror = () => setMessage("انقطع الاتصال أثناء الرفع.");
    xhr.send(form);
  };

  return (
    <Modal title="رفع ملفات" open={open} onClose={onClose}>
      <form onSubmit={submit} className="grid gap-3">
        <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-4 text-center">
          <input ref={inputRef} type="file" multiple hidden onChange={(event) => event.currentTarget.files && setFiles(Array.from(event.currentTarget.files))} />
          <Icon name="upload" className="mx-auto h-9 w-9 text-brand-700" />
          <p className="mt-2 text-sm text-gray-600">اسحب الملفات إلى المستكشف أو اخترها من الجهاز.</p>
          <button type="button" className="btn-ghost btn-sm mt-3" onClick={() => inputRef.current?.click()}>اختيار ملفات</button>
        </div>
        {files.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {files.map((file) => (
              <span key={`${file.name}-${file.size}`} className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-600">
                {file.name} · {sizeLabel(file.size)}
                <button type="button" onClick={() => setFiles((current) => current.filter((item) => item !== file))} className="text-red-600" aria-label={`إلغاء ${file.name}`}>
                  <Icon name="close" className="h-4 w-4" />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="grid gap-3 md:grid-cols-2">
          <input name="displayName" className="input" placeholder="اسم اختياري للملف الواحد" />
          <select name="folderId" className="input" defaultValue={currentFolderId || ""}>
            <option value="">بدون مجلد</option>
            {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
          </select>
          <select name="accessLevel" className="input" defaultValue="PRIVATE">
            <option value="PRIVATE">خاص</option>
            <option value="SPECIFIC_USERS">مستخدمون محددون</option>
            <option value="CONVERSATION">محادثة أو مجموعة</option>
            <option value="DEPARTMENT">قسم</option>
            <option value="CENTER">مركز</option>
            {canAdmin && <option value="ALL_STAFF">جميع الموظفين</option>}
          </select>
          <select name="conversationId" className="input">
            <option value="">المحادثة عند اختيار مستوى محادثة</option>
            {conversations.map((conversation) => <option key={conversation.id} value={conversation.id}>{conversation.title || "محادثة مباشرة"}</option>)}
          </select>
          <input name="department" className="input" placeholder="القسم عند اختيار مستوى قسم" />
          <select name="centerId" className="input">
            <option value="">المركز عند اختيار مستوى مركز</option>
            {centers.map((center) => <option key={center.id} value={center.id}>{center.name}</option>)}
          </select>
        </div>
        <textarea name="description" className="input" rows={2} placeholder="وصف اختياري" />
        {progress > 0 && <div className="h-2 overflow-hidden rounded-full bg-gray-100"><div className="h-full rounded-full bg-brand-600" style={{ width: `${progress}%` }} /></div>}
        {message && <p className="text-sm text-gray-600">{message}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>إلغاء</button>
          <button className="btn-primary">رفع</button>
        </div>
      </form>
    </Modal>
  );
}

function FolderModal({ open, onClose, folders, currentFolderId, centers }: { open: boolean; onClose: () => void; folders: FolderItem[]; currentFolderId: string | null; centers: CenterOption[] }) {
  return (
    <Modal title="إنشاء مجلد" open={open} onClose={onClose}>
      <form action={createFolderAction} className="grid gap-3">
        <input name="name" className="input" placeholder="اسم المجلد" required />
        <select name="parentId" className="input" defaultValue={currentFolderId || ""}>
          <option value="">مجلد رئيسي</option>
          {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
        </select>
        <input name="department" className="input" placeholder="القسم (اختياري)" />
        <select name="centerId" className="input">
          <option value="">بلا مركز</option>
          {centers.map((center) => <option key={center.id} value={center.id}>{center.name}</option>)}
        </select>
        <textarea name="description" className="input" rows={2} placeholder="وصف اختياري" />
        <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>إلغاء</button><button className="btn-primary">إنشاء</button></div>
      </form>
    </Modal>
  );
}

function ShareModal({ open, onClose, files, users, conversations, centers, canAdmin }: { open: boolean; onClose: () => void; files: FileItem[]; users: UserOption[]; conversations: ConversationOption[]; centers: CenterOption[]; canAdmin: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    startTransition(async () => {
      for (const file of files) await shareFileAction(file.id, form);
      router.refresh();
      onClose();
    });
  };
  return (
    <Modal title="مشاركة الملفات" open={open} onClose={onClose}>
      <form onSubmit={submit} className="grid gap-3">
        <p className="text-sm text-gray-500">{files.length} ملف محدد. الملفات قيد الفحص أو المرفوضة لا يمكن مشاركتها.</p>
        <select name="targetType" className="input">
          <option value="USER">مستخدم محدد</option>
          <option value="CONVERSATION">محادثة أو مجموعة</option>
          <option value="DEPARTMENT">قسم</option>
          <option value="CENTER">مركز</option>
          {canAdmin && <option value="ALL_STAFF">جميع الموظفين</option>}
        </select>
        <div className="grid gap-3 md:grid-cols-2">
          <select name="targetUserId" className="input"><option value="">المستخدم</option>{users.map((user) => <option key={user.id} value={user.id}>{user.fullName}</option>)}</select>
          <select name="targetConversationId" className="input"><option value="">المحادثة</option>{conversations.map((conversation) => <option key={conversation.id} value={conversation.id}>{conversation.title || "محادثة مباشرة"}</option>)}</select>
          <input name="targetDepartment" className="input" placeholder="القسم" />
          <select name="targetCenterId" className="input"><option value="">المركز</option>{centers.map((center) => <option key={center.id} value={center.id}>{center.name}</option>)}</select>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-600"><input type="checkbox" name="canEdit" /> السماح بالتعديل عند دعمه خادمياً</label>
        {files[0]?.shares.length > 0 && (
          <div className="rounded-xl border border-gray-200 p-3">
            <h3 className="mb-2 text-sm font-bold">مشاركات الملف الأول</h3>
            <div className="flex flex-wrap gap-2">
              {files[0].shares.map((share) => (
                <form key={share.id} action={revokeShareAction.bind(null, share.id)} className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-2 py-1 text-xs">
                  <span>{shareTargetLabel(share)}</span>
                  <button className="text-red-600">إلغاء</button>
                </form>
              ))}
            </div>
          </div>
        )}
        <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>إلغاء</button><button disabled={isPending} className="btn-primary">مشاركة</button></div>
      </form>
    </Modal>
  );
}

function RenameModal({ open, onClose, file }: { open: boolean; onClose: () => void; file: FileItem | null }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  if (!file) return null;
  return (
    <Modal title="إعادة تسمية" open={open} onClose={onClose}>
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          startTransition(async () => {
            await updateFileAction(file.id, form);
            router.refresh();
            onClose();
          });
        }}
      >
        <input name="displayName" className="input" defaultValue={file.displayName} required />
        <input type="hidden" name="description" value={file.description || ""} />
        <input type="hidden" name="folderId" value={file.folderId || ""} />
        <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>إلغاء</button><button disabled={isPending} className="btn-primary">حفظ</button></div>
      </form>
    </Modal>
  );
}

function MoveModal({ open, onClose, files, folders }: { open: boolean; onClose: () => void; files: FileItem[]; folders: FolderItem[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  return (
    <Modal title="نقل الملفات" open={open} onClose={onClose}>
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          const selectedFolder = String(new FormData(event.currentTarget).get("folderId") || "");
          startTransition(async () => {
            for (const file of files) {
              const form = new FormData();
              form.set("displayName", file.displayName);
              form.set("description", file.description || "");
              form.set("folderId", selectedFolder);
              await updateFileAction(file.id, form);
            }
            router.refresh();
            onClose();
          });
        }}
      >
        <p className="text-sm text-gray-500">{files.length} ملف محدد.</p>
        <select name="folderId" className="input">
          <option value="">بدون مجلد</option>
          {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
        </select>
        <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>إلغاء</button><button disabled={isPending} className="btn-primary">نقل</button></div>
      </form>
    </Modal>
  );
}

function DeleteModal({ open, onClose, files, filter, canRestore, canPermanentDelete, selectedCanDelete }: { open: boolean; onClose: () => void; files: FileItem[]; filter: string; canRestore: boolean; canPermanentDelete: boolean; selectedCanDelete: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const run = (kind: "trash" | "restore" | "permanent") => {
    startTransition(async () => {
      for (const file of files) {
        if (kind === "trash") await deleteFileAction(file.id);
        if (kind === "restore") await restoreFileAction(file.id);
        if (kind === "permanent") await permanentDeleteFileAction(file.id);
      }
      router.refresh();
      onClose();
    });
  };
  return (
    <Modal title={filter === "trash" ? "إدارة السلة" : "تأكيد الحذف"} open={open} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-gray-600">{filter === "trash" ? "اختر استرجاع الملفات أو حذفها نهائياً حسب صلاحيتك." : `سيتم نقل ${files.length} ملف إلى سلة المحذوفات.`}</p>
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>إلغاء</button>
          {filter === "trash" && canRestore && <button type="button" disabled={isPending} onClick={() => run("restore")} className="btn-ghost"><Icon name="restore" className="h-4 w-4" /> استرجاع</button>}
          {filter === "trash" && canPermanentDelete && <button type="button" disabled={isPending} onClick={() => run("permanent")} className="btn-danger">حذف نهائي</button>}
          {filter !== "trash" && <button type="button" disabled={isPending || !selectedCanDelete} onClick={() => run("trash")} className="btn-danger">نقل للسلة</button>}
        </div>
      </div>
    </Modal>
  );
}

function DetailsDrawer({ open, onClose, file, folders, users, patients, canEdit, canDownload, canAdmin }: { open: boolean; onClose: () => void; file: FileItem | null; folders: FolderItem[]; users: UserOption[]; patients: PatientOption[]; canEdit: boolean; canDownload: boolean; canAdmin: boolean }) {
  if (!open || !file) return null;
  return (
    <aside className="fixed inset-y-0 left-0 z-50 flex w-full max-w-md flex-col overflow-hidden border-r border-gray-200 bg-white shadow-2xl" role="dialog" aria-modal="true" aria-label="تفاصيل الملف">
      <header className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
        <h2 className="font-bold text-gray-900">تفاصيل الملف</h2>
        <button type="button" className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100" onClick={onClose} aria-label="إغلاق">
          <Icon name="close" className="h-5 w-5" />
        </button>
      </header>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-gray-50 text-gray-600"><Icon name={fileIconFor(file.mimeType, file.displayName)} className="h-8 w-8" /></div>
          <div className="min-w-0">
            <h3 className="truncate font-bold text-gray-900">{file.displayName}</h3>
            <p className="text-sm text-gray-500">{file.mimeType} · {sizeLabel(file.size)}</p>
          </div>
        </div>
        <div className="rounded-xl border border-gray-200 p-3 text-sm">
          <div className="flex items-center justify-between"><span>الحالة</span><span className={scanClass(file.scanStatus)}>{scanLabel[file.scanStatus] || file.scanStatus}</span></div>
          <p className="mt-2 text-gray-500">{safeScanReason(file.scanStatus)}</p>
          {file.scanStatus === "SAFE" && canDownload && <a href={`/api/collaboration/files/${file.id}/download`} className="btn-primary btn-sm mt-3 inline-flex"><Icon name="download" className="h-4 w-4" /> تنزيل</a>}
        </div>
        <dl className="grid gap-2 text-sm">
          <div className="flex justify-between gap-4"><dt className="text-gray-500">المالك</dt><dd className="font-semibold text-gray-800">{file.owner.fullName}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-gray-500">آخر تعديل</dt><dd className="font-semibold text-gray-800">{fmtDateTime(file.updatedAt)}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-gray-500">الإصدار</dt><dd className="font-semibold text-gray-800">v{file.currentVersion}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-gray-500">المجلد</dt><dd className="font-semibold text-gray-800">{file.folder?.name || "بدون مجلد"}</dd></div>
        </dl>
        {canEdit && (
          <form action={updateFileAction.bind(null, file.id)} className="grid gap-2 rounded-xl border border-gray-200 p-3">
            <h3 className="font-bold text-gray-900">تعديل البيانات</h3>
            <input name="displayName" className="input" defaultValue={file.displayName} />
            <textarea name="description" className="input" rows={2} defaultValue={file.description || ""} placeholder="وصف" />
            <select name="folderId" className="input" defaultValue={file.folderId || ""}>
              <option value="">بدون مجلد</option>
              {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
            </select>
            <button className="btn-primary btn-sm">حفظ</button>
          </form>
        )}
        <div className="rounded-xl border border-gray-200 p-3">
          <h3 className="mb-2 font-bold text-gray-900">الإصدارات</h3>
          <div className="space-y-2">
            {file.versions.map((version) => (
              <div key={version.id} className="flex items-center justify-between gap-2 rounded-lg bg-gray-50 px-3 py-2 text-sm">
                <span>v{version.version} · {sizeLabel(version.size)}</span>
                <span className={scanClass(version.scanStatus)}>{scanLabel[version.scanStatus] || version.scanStatus}</span>
                {version.scanStatus === "SAFE" && canDownload && <a href={`/api/collaboration/files/${file.id}/download?version=${version.version}`} className="text-brand-700 hover:underline">تنزيل</a>}
              </div>
            ))}
          </div>
        </div>
        {canEdit && <VersionUploadInline file={file} />}
        {canEdit && <PatientLinkInline file={file} patients={patients} />}
        {canAdmin && <OwnerTransferInline file={file} users={users} />}
      </div>
    </aside>
  );
}

function VersionUploadInline({ file }: { file: FileItem }) {
  return (
    <form action={uploadVersionAction.bind(null, file.id)} encType="multipart/form-data" className="grid gap-2 rounded-xl border border-gray-200 p-3">
      <h3 className="font-bold text-gray-900">رفع إصدار جديد</h3>
      <input name="file" type="file" className="input" required />
      <button className="btn-ghost btn-sm">رفع الإصدار</button>
    </form>
  );
}

function PatientLinkInline({ file, patients }: { file: FileItem; patients: PatientOption[] }) {
  return (
    <form action={linkPatientAction.bind(null, file.id)} className="grid gap-2 rounded-xl border border-gray-200 p-3">
      <h3 className="font-bold text-gray-900">ربط بمراجع</h3>
      <select name="patientId" className="input" required>
        <option value="">اختر المراجع</option>
        {patients.map((patient) => <option key={patient.id} value={patient.id}>{patient.fullName}، ملف #{patient.fileNumber}</option>)}
      </select>
      <label className="flex items-center gap-2 text-xs text-gray-600"><input type="checkbox" name="confirm" required /> تأكيد الربط بالمراجع</label>
      <button className="btn-ghost btn-sm">ربط</button>
    </form>
  );
}

function OwnerTransferInline({ file, users }: { file: FileItem; users: UserOption[] }) {
  return (
    <form action={transferOwnerAction.bind(null, file.id)} className="grid gap-2 rounded-xl border border-gray-200 p-3">
      <h3 className="font-bold text-gray-900">نقل الملكية</h3>
      <select name="newOwnerId" className="input" required>
        <option value="">المستخدم الجديد</option>
        {users.map((user) => <option key={user.id} value={user.id}>{user.fullName}</option>)}
      </select>
      <button className="btn-ghost btn-sm">نقل الملكية</button>
    </form>
  );
}

function VersionModal({ open, onClose, file }: { open: boolean; onClose: () => void; file: FileItem | null }) {
  if (!file) return null;
  return (
    <Modal title="رفع إصدار جديد" open={open} onClose={onClose}>
      <VersionUploadInline file={file} />
    </Modal>
  );
}

function PatientModal({ open, onClose, file, patients }: { open: boolean; onClose: () => void; file: FileItem | null; patients: PatientOption[] }) {
  if (!file) return null;
  return (
    <Modal title="ربط بمراجع" open={open} onClose={onClose}>
      <PatientLinkInline file={file} patients={patients} />
    </Modal>
  );
}

function OwnerModal({ open, onClose, file, users }: { open: boolean; onClose: () => void; file: FileItem | null; users: UserOption[] }) {
  if (!file) return null;
  return (
    <Modal title="نقل الملكية" open={open} onClose={onClose}>
      <OwnerTransferInline file={file} users={users} />
    </Modal>
  );
}
