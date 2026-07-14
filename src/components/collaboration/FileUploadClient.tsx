"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

export function FileUploadClient({ conversationId, compact = false }: { conversationId?: string; compact?: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [drag, setDrag] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");

  const upload = (files: FileList | File[]) => {
    const selected = Array.from(files);
    if (!selected.length) return;
    const form = new FormData();
    for (const file of selected) form.append("files", file);
    form.set("accessLevel", conversationId ? "CONVERSATION" : "PRIVATE");
    if (conversationId) form.set("conversationId", conversationId);
    setMessage("جار رفع الملف وفحصه...");
    setProgress(0);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/collaboration/files");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) setProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText || "{}");
        if (xhr.status >= 200 && xhr.status < 300) {
          setMessage("اكتمل الرفع. ستظهر حالة الفحص ضمن مركز الملفات.");
          setProgress(100);
          router.refresh();
        } else {
          setMessage(data.error || "تعذر رفع الملف");
        }
      } catch {
        setMessage("تعذر قراءة نتيجة الرفع");
      }
    };
    xhr.onerror = () => setMessage("انقطع الاتصال أثناء الرفع");
    xhr.send(form);
  };

  return (
    <div
      className={`rounded-lg border border-dashed p-3 ${drag ? "border-brand-500 bg-brand-50" : "border-gray-300 bg-white"}`}
      onDragOver={(event) => { event.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(event) => { event.preventDefault(); setDrag(false); upload(event.dataTransfer.files); }}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        onChange={(event) => event.currentTarget.files && upload(event.currentTarget.files)}
      />
      <div className={`flex ${compact ? "items-center justify-between gap-2" : "flex-col gap-2"}`}>
        <div className="text-sm text-gray-600">اسحب الملفات هنا أو اخترها من الجهاز</div>
        <button type="button" className="btn-ghost btn-sm" onClick={() => inputRef.current?.click()}>اختيار ملفات</button>
      </div>
      {progress > 0 && (
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-100">
          <div className="h-full bg-brand-600 transition-all" style={{ width: `${progress}%` }} />
        </div>
      )}
      {message && <p className="mt-2 text-xs text-gray-500">{message}</p>}
    </div>
  );
}
