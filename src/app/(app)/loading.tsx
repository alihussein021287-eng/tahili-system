import { LoadingState } from "@/components/Ui";

export default function Loading() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-2xl items-center justify-center"><LoadingState label="جارٍ تجهيز الصفحة..." /></div>
  );
}
