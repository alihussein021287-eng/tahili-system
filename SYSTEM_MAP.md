# System Map

خريطة مختصرة تساعد Codex والمطورين على الوصول السريع للملفات. المصدر النهائي للسلوك هو الكود.

| الوحدة | routes مهمة | ملفات `src/app` | logic في `src/lib` | صلاحيات رئيسية | علاقات وتبعيات |
| --- | --- | --- | --- | --- | --- |
| المرضى والرعاية | `/patients-care?tab=overview`, `/patients`, `/queue`, `/visits`, `/appointments`, `/referrals`, `/patients/[id]` | `patients-care/page.tsx`, `patients/**`, `queue/page.tsx`, `appointments/**`, `referrals/**`, `visits/page.tsx` | `access.ts`, `branch-context.ts`, `queue.ts`, `referral-service.ts`, `referral-workflow.ts`, `labels.ts` | `patients.*`, `visits.*`, `queue.*`, `appointments.*`, `referrals.*`, `journey.*` | Patient هو المحور؛ يرتبط بالزيارات والطابور والمواعيد والإحالات والتقارير والمسار. |
| المسار العلاجي والمراكز | `/therapy-centers?tab=overview`, `plans`, `sessions`, `today`, `centers`, `beds`, `meds`; `/therapy`, `/centers/[slug]` | `therapy-centers/page.tsx`, `therapy/**`, `centers/**`, `beds/page.tsx`, `meds/page.tsx` | `therapy-plan-rules.ts`, `center-access.ts`, `center-workspaces.ts`, `center-halls.ts`, `access.ts` | `therapy.*`, `clinical.plan`, `clinical.session`, `centers.*`, `beds.*`, `meds.*`, `workload.view` | TreatmentPlan وTherapySession ترتبط بالمراجع والمعالج والمركز والقاعة؛ CenterMembership يحدد نطاق رئيس المعالجين والمعالجين. |
| الصيدلية والمخزون | `/pharmacy-inventory?tab=overview`, `dispense`, `stock`, `batches`, `purchases`, `reports`; `/pharmacy/**`, `/inventory` | `pharmacy-inventory/page.tsx`, `pharmacy/**`, `inventory/page.tsx` | `labels.ts`, `access.ts`, `arabic-money.ts` | `pharmacy.*`, `inventory.*`, `pharmacy.purchase.*` | Prescription يربط المراجع والدواء؛ MedicationBatch وStockMovement وPurchaseOrder تغذي المخزون والتقارير. |
| التقارير والمالية | `/reports-finance?tab=overview`, `official`, `patients`, `finance`, `wounded`, `approvals`; `/reports/**`, `/finance/**`, `/official-docs`, `/approvals` | `reports-finance/page.tsx`, `reports/**`, `finance/**`, `official-docs/**`, `approvals/page.tsx` | `expense-approval.ts`, `arabic-money.ts`, `labels.ts`, `audit.ts` | `reports.*`, `finance.*`, `expenses.*`, `approvals.*`, `officialdocs.*`, `patients.export` | MedicalReport، Invoice، Payment، WoundedExpense، ApprovalRequest، OfficialDocument. مبالغ الصرفيات محكومة بـ `expenses.amounts`. |
| الموظفون والمهام | `/staff?tab=overview`, `employees`, `attendance`, `shifts`, `leaves`, `tasks`; `/users`, `/tasks`, `/attendance`, `/shifts` | `staff/page.tsx`, `users/**`, `tasks/**`, `attendance/**`, `shifts/**` | `permissions.ts`, `perms.ts`, `role-workspaces.ts`, `presence.ts`, `user-deletion.ts` | `users.*`, `attendance.*`, `shifts.*`, `tasks.*` | User هو محور الحسابات؛ Task وAttendance وShift وLeave تعتمد على المستخدم أو الدور. |
| النظام والإعدادات | `/settings`, `/users`, `/permissions`, `/audit`, `/login-log`, `/backup`, `/readiness`, `/maintenance` | `settings/**`, `users/**`, `permissions/page.tsx`, `audit/page.tsx`, `login-log/page.tsx`, `backup/page.tsx`, `readiness/page.tsx` | `admin-config.ts`, `backup.ts`, `readiness.ts`, `readiness-config.ts`, `admin-security.ts`, `permission-store.ts`, `session-validation.ts` | `settings.*`, `users.*`, `audit.view`, `maintenance/backup/readiness` عبر `settings.view` و`settings.backup` | إعدادات OrgSetting، صلاحيات RolePermission/UserPermission، سجلات AuditLog/LoginLog. |
| التعاون والملفات | `/collaboration`, `/collaboration/files`, `/collaboration/admin`, API تحت `/api/collaboration/**` | `collaboration/**`, API routes ذات الصلة | `collaboration-service.ts`, `collaboration-storage.ts`, `collaboration-scan.ts`, `collaboration-preview.ts`, `collaboration-rules.ts` | `collaboration.*`, `chat.*`, `files.*` | يعتمد على MinIO وClamAV؛ CollaborationFile/FileVersion/FileShare مرتبطة بالمستخدمين والمراجع اختيارياً. |
| التنبيهات | `/notifications` وروابط التنبيهات داخل السايدبار | `notifications/page.tsx`, layout app | `notifications.ts`, `notif-actions.ts`, `notify.ts`, `readiness.ts` | غالباً `dashboard.view` مع فلترة رابط الإشعار حسب `canOpenNotification` | Notification يرسل للمستخدم أو الدور؛ الروابط لا تظهر إذا لا يملك المستخدم صلاحية فتحها. |

## روابط الملاحة الجامعة

السايدبار يدار في `src/components/AppShell.tsx`. حافظ على بقاء routes القديمة عاملة، واستخدم الصفحات الجامعة مع tabs عند تنظيم الروابط الجديدة.

## جرد الواجهات

الجرد الكامل القابل للاختبار موجود في `docs/UX_ROUTE_INVENTORY.md` ويغطي كل `page.tsx` و`route.ts`، بما فيها الصفحات الديناميكية والطباعة وواجهات API.

| المؤشر | العدد |
| --- | ---: |
| صفحات واجهة مكتشفة | 92 |
| صفحات تشغيل مطوّرة بصرياً | 72 |
| شاشات متخصصة لا تحتاج تغييراً | 4 |
| صفحات طباعة | 13 |
| routes توافق قديمة مرتبطة بالصفحات الجامعة | 3 |
| Route Handlers / API | 18 |
| صفحات غير مفحوصة | 0 |

الروابط القديمة `/attendance`, `/shifts`, و`/tasks` تحول إلى تبويبات `/staff` وتحافظ على المعلمات. المسارات التشغيلية الأخرى القديمة تبقى فعالة ويحدد `AppShell` مجموعتها الجامعة النشطة.
