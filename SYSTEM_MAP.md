# System Map

## Shared presentation and reference sources

- Theme contract: `src/lib/theme.ts` + semantic variables and legacy compatibility in `src/app/globals.css`; AppShell exposes `light/dark/system`.
- Approved reference source: `scripts/reference-data.ts`; operator workflow: `scripts/sync-reference-data.ts` with dry-run by default and transactional `--apply`.
- Reference matching uses normalized names and center + hall natural pairs. Medicine sync creates catalog rows at zero only and never creates stock batches.

خريطة مختصرة تساعد Codex والمطورين على الوصول السريع للملفات. المصدر النهائي للسلوك هو الكود.

| الوحدة | routes مهمة | ملفات `src/app` | logic في `src/lib` | صلاحيات رئيسية | علاقات وتبعيات |
| --- | --- | --- | --- | --- | --- |
| المرضى والرعاية | `/patients-care?tab=overview`, `/patients`, `/queue`, `/visits`, `/appointments`, `/referrals`, `/patients/[id]` | `patients-care/page.tsx`, `patients/**`, `queue/page.tsx`, `appointments/**`, `referrals/**`, `visits/page.tsx` | `access.ts`, `branch-context.ts`, `queue.ts`, `referral-service.ts`, `referral-workflow.ts`, `labels.ts` | `patients.*`, `visits.*`, `queue.*`, `appointments.*`, `referrals.*`, `journey.*` | Patient هو المحور؛ يرتبط بالزيارات والطابور والمواعيد والإحالات والتقارير والمسار. |
| المسار العلاجي والمراكز | `/therapy-centers?tab=overview`, `plans`, `sessions`, `today`, `centers`, `beds`, `meds`; `/therapy`, `/centers/[slug]` | `therapy-centers/page.tsx`, `therapy/**`, `centers/**`, `beds/page.tsx`, `meds/page.tsx` | `therapy-plan-rules.ts`, `center-access.ts`, `center-workspaces.ts`, `center-halls.ts`, `access.ts` | `therapy.*`, `clinical.plan`, `clinical.session`, `centers.*`, `beds.*`, `meds.*`, `workload.view` | TreatmentPlan وTherapySession ترتبط بالمراجع والمعالج والمركز والقاعة؛ CenterMembership يحدد نطاق رئيس المعالجين والمعالجين. |
| الصيدلية والمخزون | `/pharmacy-inventory?tab=overview`, `dispense`, `stock`, `batches`, `purchases`, `reports`; `/pharmacy/**`, `/inventory` | `pharmacy-inventory/page.tsx`, `pharmacy/**`, `inventory/page.tsx` | `labels.ts`, `access.ts`, `arabic-money.ts` | `pharmacy.*`, `inventory.*`, `pharmacy.purchase.*` | Prescription يربط المراجع والدواء؛ MedicationBatch وStockMovement وPurchaseOrder تغذي المخزون والتقارير. |
| التقارير والمالية | `/reports-finance?tab=overview`, `official`, `patients`, `finance`, `wounded`, `approvals`; `/reports/**`, `/finance/**`, `/official-docs`, `/approvals` | `reports-finance/page.tsx`, `reports/**`, `finance/**`, `official-docs/**`, `approvals/page.tsx` | `expense-approval.ts`, `arabic-money.ts`, `labels.ts`, `audit.ts` | `reports.*`, `finance.*`, `expenses.*`, `approvals.*`, `officialdocs.*`, `patients.export` | MedicalReport، Invoice، Payment، WoundedExpense، ApprovalRequest، OfficialDocument. مبالغ الصرفيات محكومة بـ `expenses.amounts`. |
| الموظفون والمهام | `/staff?tab=overview`, `employees`, `attendance`, `shifts`, `leaves`, `tasks`; `/users`, `/tasks`, `/attendance`, `/shifts` | `staff/page.tsx`, `users/**`, `tasks/**`, `attendance/**`, `shifts/**` | `permissions.ts`, `perms.ts`, `role-workspaces.ts`, `presence.ts`, `user-deletion.ts` | `users.*`, `attendance.*`, `shifts.*`, `tasks.*` | User هو محور الحسابات؛ Task وAttendance وShift وLeave تعتمد على المستخدم أو الدور. |
| النظام والإعدادات | `/settings`, `/users`, `/permissions`, `/audit`, `/login-log`, `/backup`, `/readiness`, `/observability`, `/maintenance` | `settings/**`, `users/**`, `permissions/page.tsx`, `audit/page.tsx`, `login-log/page.tsx`, `backup/page.tsx`, `readiness/page.tsx`, `observability/page.tsx` | `admin-config.ts`, `backup.ts`, `readiness.ts`, `readiness-config.ts`, `observability-summary.ts`, `admin-security.ts`, `permission-store.ts`, `session-validation.ts` | `settings.*`, `users.*`, `audit.view`; `/observability` حصرية لـADMIN مع رابط مخفي لباقي الأدوار | صفحة المراقبة DTO مجمّع من Prometheus/Alertmanager/Tempo/Loki داخل Docker فقط؛ لا Docker socket أو raw logs/traces أو معرّفات طلب. |

| التعاون والملفات | `/collaboration`, `/collaboration/files`, `/collaboration/admin`, API تحت `/api/collaboration/**` | `collaboration/**`, API routes ذات الصلة | `collaboration-service.ts`, `collaboration-storage.ts`, `collaboration-scan.ts`, `collaboration-preview.ts`, `collaboration-rules.ts` | `collaboration.*`, `chat.*`, `files.*` | يعتمد على MinIO وClamAV؛ CollaborationFile/FileVersion/FileShare مرتبطة بالمستخدمين والمراجع اختيارياً. |
| التنبيهات | `/notifications` وروابط التنبيهات داخل السايدبار | `notifications/page.tsx`, layout app | `notifications.ts`, `notif-actions.ts`, `notify.ts`, `readiness.ts` | غالباً `dashboard.view` مع فلترة رابط الإشعار حسب `canOpenNotification` | Notification يرسل للمستخدم أو الدور؛ الروابط لا تظهر إذا لا يملك المستخدم صلاحية فتحها. |
| العمل اليومي المشتق | `/`, `/workspaces`, `/my-work`, وبطاقة الرحلة في `/patients/[id]` | `page.tsx`, `workspaces/page.tsx`, `my-work/page.tsx`, `patients/[id]/page.tsx` | `work-registry.ts`, `my-work.ts`, `patient-journey.ts` | الصلاحية الفعلية لكل مصدر ورابط؛ `dashboard.view` لفتح قائمة العمل | View Model فقط: يجمع حالات موجودة باستعلامات محدودة، يزيل التكرار، ولا ينشئ Task أو Journey state جديداً. |

## أدوات التشخيص المحلية

`scripts/tahili-diagnose.mjs` هو CLI read-only للتطوير، ويغطي الملخصات المسموح بها من Docker inspect وPrometheus وAlertmanager وLoki وTempo عبر Docker bridge. لا يدخل الحاويات ولا يقبل queries أو URLs من المستخدم ولا يطبع raw logs/spans. مهارة Codex المقابلة موجودة في `codex-skills/tahili-incident-diagnostics` وتثبت محلياً فقط في `/root/.codex/skills`; MCP مؤجل لحين توفر SDK محلي مدقق.

## روابط الملاحة الجامعة

تعريف routes والـhubs والتبويبات وصلاحيات الظهور وترتيب الأدوار موجود مركزياً في `src/lib/work-registry.ts` ويستهلكه `AppShell`. حافظ على بقاء routes القديمة عاملة، واستخدم الصفحات الجامعة مع tabs عند تنظيم الروابط الجديدة.

## جرد الواجهات

الجرد الكامل القابل للاختبار موجود في `docs/UX_ROUTE_INVENTORY.md` ويغطي كل `page.tsx` و`route.ts`، بما فيها الصفحات الديناميكية والطباعة وواجهات API.

| المؤشر | العدد |
| --- | ---: |
| صفحات واجهة مكتشفة | 94 |
| صفحات تشغيل مطوّرة بصرياً | 73 |
| شاشات متخصصة لا تحتاج تغييراً | 4 |
| صفحات طباعة | 13 |
| routes توافق قديمة مرتبطة بالصفحات الجامعة | 3 |
| Route Handlers / API | 21 |
| صفحات غير مفحوصة | 0 |

## Deterministic Inventory And Boundaries

- شغّل `node scripts/audit-project.mjs` للجرد JSON، أو `node scripts/audit-project.mjs --markdown` لتوليد جدول الصفحات.
- الجرد الحالي: 94 صفحة، 21 API route، 36 ملف Actions و256 Server Action مصدرة، 47 ملف component، 66 ملف `src/lib`، 87 Prisma model، 61 enum، 139 permission، 15 role، 77 ملف اختبار، و16 migration.
- التصنيف التفصيلي لكل صفحة موجود في `docs/UI_INFORMATION_ARCHITECTURE.md`; غير المصنف = 0.
- حدود الدورات الطبية والعلاجية والمالية في `docs/MEDICAL_WORKFLOW_BOUNDARIES.md`.
- سجل التكرار وقرار الإبقاء/التوحيد في `docs/UI_DUPLICATION_REGISTER.md`.
- خطة الدفعات المستقبلية في `docs/FUTURE_UI_ROADMAP.md`.

تحسين UX لا يغير workflow. إذا احتاجت الواجهة تعديل Action أو transition أو permission أو schema، توقف وافصل الطلب كتغيير وظيفي.

الروابط القديمة `/attendance`, `/shifts`, و`/tasks` تحول إلى تبويبات `/staff` وتحافظ على المعلمات. المسارات التشغيلية الأخرى القديمة تبقى فعالة ويحدد `AppShell` مجموعتها الجامعة النشطة.
