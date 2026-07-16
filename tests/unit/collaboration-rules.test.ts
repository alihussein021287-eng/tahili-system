import { describe, expect, it, vi } from "vitest";
import {
  assertCanGrantFileAccess,
  assertMedicalFileShareAllowed,
  canEditMessage,
  canModerateConversation,
  canUseCenter,
  canUseDepartment,
  collaborationDownloadFileName,
  detectMime,
  directConversationKey,
  sanitizeFileName,
  shareKey,
  validateCollaborationUpload,
} from "@/lib/collaboration-rules";
import {
  MAX_OFFICE_PREVIEW_BYTES,
  collaborationPreviewPolicy,
  isOfficePreviewSupported,
  officePreviewType,
} from "@/lib/collaboration-preview";
import { scanBufferWithClamAv } from "@/lib/collaboration-scan";

const actor = (overrides: Partial<any> = {}) => ({
  id: "user-1",
  role: "THERAPIST",
  department: "العلاج",
  centerIds: [7],
  permissions: new Set(["collaboration.view", "chat.send", "files.view", "files.upload", "files.download", "files.share"]),
  ...overrides,
});

const settings = {
  maxUploadMb: 10,
  allowedTypes: ["pdf", "jpg", "jpeg", "png", "zip", "mp4"],
  blockedTypes: ["exe", "msi", "bat", "cmd", "com", "ps1", "sh", "js", "jar", "scr", "dll"],
};

const docxMime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const xlsxMime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const pptxMime = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

function officeZip(marker: string) {
  return Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.from(` [Content_Types].xml ${marker}`, "latin1"),
  ]);
}

describe("collaboration conversation rules", () => {
  it("uses one stable key for a direct conversation between two users", () => {
    expect(directConversationKey("b", "a")).toBe(directConversationKey("a", "b"));
    expect(directConversationKey("a", "b")).toBe("direct:a:b");
  });

  it("allows owners and explicit moderators to manage group messages and members", () => {
    expect(canModerateConversation(actor(), "OWNER")).toBe(true);
    expect(canModerateConversation(actor({ permissions: new Set(["chat.moderate"]) }), "MEMBER")).toBe(true);
    expect(canModerateConversation(actor({ permissions: new Set([]) }), "MEMBER")).toBe(false);
  });

  it("enforces the edit window for normal message authors", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-14T12:30:00Z"));
    expect(canEditMessage({ actor: actor(), senderId: "user-1", createdAt: new Date("2026-07-14T12:20:00Z"), editWindowMinutes: 15 })).toBe(true);
    expect(canEditMessage({ actor: actor(), senderId: "user-1", createdAt: new Date("2026-07-14T12:00:00Z"), editWindowMinutes: 15 })).toBe(false);
    expect(canEditMessage({ actor: actor(), senderId: "user-2", createdAt: new Date("2026-07-14T12:29:00Z"), editWindowMinutes: 15 })).toBe(false);
    vi.useRealTimers();
  });
});

describe("collaboration file security rules", () => {
  it("sanitizes names and rejects executable or double-extension files", () => {
    expect(sanitizeFileName("../تقرير.pdf")).toBe(".. تقرير.pdf");
    const pdf = Buffer.from("%PDF-1.7\ncontent");
    expect(() => validateCollaborationUpload({ name: "report.pdf.exe", size: 20, buffer: pdf, declaredType: "application/pdf", settings })).toThrow("تنفيذي");
    expect(() => validateCollaborationUpload({ name: "run.sh", size: 20, buffer: Buffer.from("#!/bin/sh\necho x"), declaredType: "text/plain", settings })).toThrow();
  });

  it("validates MIME from content instead of trusting the declared browser type", () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    expect(detectMime(png, "application/pdf")).toBe("image/png");
    const result = validateCollaborationUpload({ name: "safe.png", size: png.length, buffer: png, declaredType: "application/pdf", settings });
    expect(result.mimeType).toBe("image/png");
  });

  it("detects supported Office files inside OOXML zip containers", () => {
    expect(detectMime(officeZip("word/document.xml"), "application/zip")).toBe(docxMime);
    expect(detectMime(officeZip("xl/workbook.xml"), "application/zip")).toBe(xlsxMime);
    expect(detectMime(officeZip("ppt/presentation.xml"), "application/zip")).toBe(pptxMime);
  });

  it("keeps empty or failed-scan files quarantined", async () => {
    await expect(scanBufferWithClamAv(Buffer.alloc(0))).resolves.toMatchObject({ status: "FAILED" });
    expect(() => validateCollaborationUpload({ name: "empty.pdf", size: 0, buffer: Buffer.alloc(0), declaredType: "application/pdf", settings })).toThrow("فارغ");
  });

  it("prevents users from granting broader center, department, or all-staff access", () => {
    expect(canUseCenter(actor(), 7)).toBe(true);
    expect(canUseCenter(actor(), 8)).toBe(false);
    expect(canUseDepartment(actor(), "العلاج")).toBe(true);
    expect(canUseDepartment(actor(), "الإدارة")).toBe(false);
    expect(() => assertCanGrantFileAccess(actor(), { centerId: 8 })).toThrow("مراكزك");
    expect(() => assertCanGrantFileAccess(actor(), { allStaff: true })).toThrow("كل الموظفين");
  });

  it("deduplicates shares and protects medical file sharing", () => {
    expect(shareKey({ type: "USER", userId: "u1" })).toBe("user:u1");
    expect(shareKey({ type: "CENTER", centerId: 7 })).toBe("center:7");
    expect(() => assertMedicalFileShareAllowed({ patientId: "p1", targetType: "ALL_STAFF", allRecipientsCanViewPatient: true })).toThrow("نطاق عام");
    expect(() => assertMedicalFileShareAllowed({ patientId: "p1", targetType: "USER", allRecipientsCanViewPatient: false })).toThrow("صلاحية رؤية");
    expect(() => assertMedicalFileShareAllowed({ patientId: "p1", targetType: "USER", allRecipientsCanViewPatient: true })).not.toThrow();
  });
});

describe("collaboration file download names", () => {
  it("keeps the original extension on normal downloads", () => {
    expect(
      collaborationDownloadFileName({
        displayName: "tah.docx",
        originalName: "tah.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        version: 1,
      }),
    ).toBe("tah.docx");
  });

  it("adds explicit version labels before the extension", () => {
    expect(
      collaborationDownloadFileName({
        displayName: "tah.docx",
        originalName: "tah.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        version: 1,
        includeVersion: true,
      }),
    ).toBe("tah.v1.docx");
  });

  it("restores the original extension after a display-name rename", () => {
    expect(
      collaborationDownloadFileName({
        displayName: "تقرير التأهيل",
        originalName: "tah.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        version: 2,
      }),
    ).toBe("تقرير التأهيل.docx");
  });
});

describe("collaboration file preview policy", () => {
  it("allows safe browser-rendered media and PDF through stream preview", () => {
    expect(collaborationPreviewPolicy({ mimeType: "image/png", name: "scan.png", scanStatus: "SAFE" })).toMatchObject({ kind: "image", canPreview: true, canStream: true });
    expect(collaborationPreviewPolicy({ mimeType: "image/bmp", name: "scan.bmp", scanStatus: "SAFE" })).toMatchObject({ kind: "image", canPreview: true, canStream: true });
    expect(collaborationPreviewPolicy({ mimeType: "application/pdf", name: "report.pdf", scanStatus: "SAFE" })).toMatchObject({ kind: "pdf", canPreview: true, canStream: true });
    expect(collaborationPreviewPolicy({ mimeType: "video/mp4", name: "clip.mp4", scanStatus: "SAFE" })).toMatchObject({ kind: "video", canPreview: true, canStream: true });
  });

  it("previews text as escaped app data instead of iframe streaming", () => {
    expect(collaborationPreviewPolicy({ mimeType: "application/json", name: "data.json", scanStatus: "SAFE" })).toMatchObject({ kind: "text", canPreview: true, canStream: false });
    expect(collaborationPreviewPolicy({ mimeType: "text/xml", name: "notes.xml", scanStatus: "SAFE" })).toMatchObject({ kind: "text", canPreview: true, canStream: false });
  });

  it("blocks unsafe or unscanned content from preview", () => {
    expect(collaborationPreviewPolicy({ mimeType: "text/html", name: "page.html", scanStatus: "SAFE" })).toMatchObject({ kind: "blocked", canPreview: false });
    expect(collaborationPreviewPolicy({ mimeType: "text/plain", name: "script.sh", scanStatus: "SAFE" })).toMatchObject({ kind: "blocked", canPreview: false });
    expect(collaborationPreviewPolicy({ mimeType: "application/pdf", name: "pending.pdf", scanStatus: "PENDING_SCAN" })).toMatchObject({ kind: "blocked", canPreview: false });
  });

  it("prepares supported Office files for local PDF preview", () => {
    expect(collaborationPreviewPolicy({
      mimeType: docxMime,
      name: "letter.docx",
      scanStatus: "SAFE",
      size: 1000,
    })).toMatchObject({ kind: "office", canPreview: true, canStream: false });
    expect(collaborationPreviewPolicy({
      mimeType: "application/zip",
      name: "sheet.xlsx",
      scanStatus: "SAFE",
      size: 1000,
    })).toMatchObject({ kind: "office", canPreview: true, canStream: false });
    expect(officePreviewType({ mimeType: pptxMime, name: "slides.pptx" })).toBe("pptx");
    expect(isOfficePreviewSupported({ mimeType: xlsxMime, name: "sheet.xlsx", scanStatus: "SAFE", size: 1000 })).toBe(true);
  });

  it("honors configured Office preview enablement and size limit", () => {
    expect(collaborationPreviewPolicy({
      mimeType: docxMime,
      name: "letter.docx",
      scanStatus: "SAFE",
      size: 1000,
    }, { officePreviewEnabled: false, officePreviewMaxMb: 25 })).toMatchObject({ kind: "office", canPreview: false });
    expect(collaborationPreviewPolicy({
      mimeType: docxMime,
      name: "letter.docx",
      scanStatus: "SAFE",
      size: 2 * 1024 * 1024,
    }, { officePreviewEnabled: true, officePreviewMaxMb: 1 })).toMatchObject({ kind: "office", canPreview: false });
    expect(isOfficePreviewSupported({
      mimeType: docxMime,
      name: "letter.docx",
      scanStatus: "SAFE",
      size: 2 * 1024 * 1024,
    }, { officePreviewMaxMb: 1 })).toBe(false);
  });

  it("rejects Office preview when MIME, extension, status, or size are unsafe", () => {
    expect(collaborationPreviewPolicy({
      mimeType: docxMime,
      name: "letter.xlsx",
      scanStatus: "SAFE",
      size: 1000,
    })).toMatchObject({ kind: "unsupported", canPreview: false });
    expect(collaborationPreviewPolicy({
      mimeType: docxMime,
      name: "letter.docx",
      scanStatus: "SAFE",
      size: MAX_OFFICE_PREVIEW_BYTES + 1,
    })).toMatchObject({ kind: "office", canPreview: false, canStream: false });
    expect(isOfficePreviewSupported({ mimeType: docxMime, name: "letter.docx", scanStatus: "PENDING_SCAN", size: 1000 })).toBe(false);
  });
});
