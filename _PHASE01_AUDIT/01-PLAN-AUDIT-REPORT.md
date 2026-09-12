# Tahili — Saif Plan Audit Report

Branch: `update/01-guid-foundation`  
Baseline: `82b0c79e2d82c75df52ca9bbd9f1020f1ee5a205`  
Plan source: `Tahili_System_Plan_Saif_Style_RTL`

## التنفيذ المسموح حالياً

هذه المرحلة توثيق وفحص فقط. لم يتم تعديل `prisma/schema.prisma`، ولم تُنشأ migration، ولم يُحذف أي legacy model/field، لأن بوابة Phase 0 الخاصة بنسخة Production الكاملة + verify + isolated restore لم تُنفذ بعد بسبب عدم توفر الوصول إلى الشبكة الداخلية حالياً.

هذا مقصود حتى نلتزم بقاعدة الخطة: لا نصعد للمرحلة التالية قبل نجاح السابقة، ولا حذف أو تحويل destructive قبل migration/backfill وفحص فعلي.

## Baseline الهوية الحالية

الجرد الحالي للـModels:

- 87 model بالمخطط الحالي.
- 67 model تستخدم `String @id @default(cuid())`.
- 17 model تستخدم `Int @id @default(autoincrement())`.
- 2 singleton/config models تستخدم Int ثابت (`OrgSetting`, `CollaborationSettings`).
- `UserPreference` يستخدم `userId` كمفتاح أساسي بدل حقل `id` مستقل.
- لا يوجد حالياً Primary Key مخزن PostgreSQL native `uuid` ضمن الجرد المستهدف.

## المشاكل المؤكدة من الكود الحالي مقابل الخطة

### 1. CareStage ما زال هو state/routing عام

`CareStage` يحتوي `responsibleRole`, `sequence`, `status`، وبالتالي يربط رحلة المراجع بدور وتسلسل عام. هذا هو الجزء المطلوب استبداله لاحقاً بـ`PatientWorkItem` بعد migration وليس بحذف مباشر.

### 2. الإحالة تضيع الإسناد الشخصي بعد القبول الداخلي

`ReferralRequest.assignedReviewerId` موجود فعلاً، لكن عند قبول إحالة داخلية تقوم `referral-service.ts` بإنشاء `CareStage` وتضع `responsibleRole` على `DOCTOR` أو `HEAD_THERAPIST`. لذلك الإسناد الشخصي/الوحدة لا يبقى هو مصدر الحقيقة التشغيلي.

### 3. Referral workflow ما زال ينتج Role recipients

`referral-workflow.ts` يعيد `NotificationRecipient` من نوع `ROLE` في بعض الانتقالات (MANAGER/DOCTOR). هذا صالح لاحقاً فقط للـbroadcast العام، وليس كمالك لمعاملة مراجع محددة.

### 4. Task يدعم assignedRole تشغيلياً

`Task` يحتوي `assignedToId` و`assignedRole`، و`createTask` ينشئ إشعاراً للمستخدم أو للدور. حسب الخطة، المعاملة/الشغل التشغيلي يجب أن يسند إلى User أو Unit، وRole يبقى للصلاحيات فقط.

### 5. Appointment conflict ما زال يعتمد الاسم النصي

الـschema يحتوي `assignedToId`، لكن `createAppointment` و`appointmentConflict` يعتمدان `assignedTo` النصي في إنشاء الموعد وكشف التعارض. المطلوب لاحقاً الاعتماد على ID الحقيقي ثم إزالة النص تدريجياً بعد backfill.

### 6. Attendance / Shift / Leave تعتمد الاسم

`Attendance.name`, `Shift.name`, `Leave.name` هي مصدر الربط الحالي في Actions. الخطة تطلب StaffMember حقيقي ثم `staffMemberId` مع بقاء الاسم snapshot فقط إن احتجناه للعرض، وليس كمفتاح تشغيلي.

### 7. Journey ما زالت تقرأ CareStage وRole

`patient-journey.ts` يقرأ `careStages`, `responsibleRole`, ويفترض current CareStage. حسب الخطة يجب لاحقاً أن تصبح Journey derived view من WorkItems + السجلات الفعلية ولا تخزن state منافس.

### 8. access الحالي Permission-centric فقط

`src/lib/access.ts` يحسب Role defaults ثم RolePermission ثم UserPermission ويحمي الصفحة/Action، لكنه لا يملك بعد contract موحداً لـ`ownership + unit scope + supervisor override` الخاص بالـWorkItem. هذا يضاف في مراحل WorkItem/Security ولا يُخلط مع مجرد permissions.

### 9. Notification تدعم targetRole وtargetUserId فقط

لا يوجد `targetUnitId` حالياً. الخطة تطلب `notifyUser` و`notifyUnit` للمعاملات، مع إبقاء `targetRole` للـbroadcast العام فقط.

## تصنيف الهوية — قرار المرحلة قبل أي Migration

### A — Foundation anchors: أول دفعة بعد نجاح Phase 0

هذه الكيانات هي anchors للمراحل الجديدة ويجب إعداد native UUID لها قبل Unit/Staff/WorkItem:

- `User`
- `Patient`
- `Branch`
- `Center`
- `ReferralRequest`

السبب: `StaffMember`, `UserUnitMembership`, `PatientWorkItem`, والإسناد الجديد ستعتمد عليها. التحويل لن يكون cast مباشر؛ سنستخدم UUID side-by-side + mapping/backfill + dual-read/write مؤقت + validation ثم cutover.

### B — Models جديدة يجب أن تولد native UUID من أول يوم

عند الوصول لمراحلها:

- `Unit`
- `StaffMember`
- `UserUnitMembership`
- `PatientWorkItem`

أي PK/FK جديد في هذه النماذج سيكون PostgreSQL `uuid` فعلياً.

### C — Legacy لا نحوله لمجرد أنه موجود

- `CareStage`: يُرحل المفتوح إلى WorkItem ثم يزال بعد نجاح cutover.
- `Employee`: يُرحل إلى StaffMember ثم يزال.
- `PATHWAY_DEFAULT` وأي routing مبني على CareStage: يزال بعد تشغيل WorkItem routing.

لا فائدة من استثمار migration UUID كامل في model مخطط لإزالته.

### D — Freeze / disposition first

كل Collaboration يبقى مجمداً حالياً. لا نبدأ UUID migration له قبل قرار رسمي بالاحتفاظ بالموديول أو حذفه بعد فحص البيانات. Patient Attachments تبقى مستقلة عن هذا القرار.

### E — Deferred operational IDs

بعد تثبيت foundation نراجع على دفعات: `Appointment`, `Task`, `Notification`, therapy/center operational records, pharmacy/inventory records, beds/rooms/halls وغيرها. التحويل يكون حسب dependency graph وليس global replace.

### F — Singleton/config IDs

`OrgSetting` و`CollaborationSettings` ليسا هوية تشغيلية موزعة؛ لا يوجد سبب لتحويل الـID الثابت الآن.

### G — Lookup IDs

`Governorate`, `District`, `Formation`, `InjuryType`, `MobilityAid`, `ProstheticType`, `Rank` تؤجل إلى مراجعة منفصلة. لا نحول lookups فقط لتحقيق رقم UUID شكلي قبل أن نثبت أن العلاقة التشغيلية تحتاج ذلك.

## ترتيب التنفيذ المثبت من الخطة

1. Phase 0 — Backup + Baseline.
2. Phase 1 — GUID Foundation.
3. Phase 2 — Unit + StaffMember + UserUnitMembership.
4. Phase 3 — PatientWorkItem + assignment/claim/accept/start/complete/reassign service.
5. Phase 4 — Referrals + parallel branches.
6. Phase 5 — Journey + My Work + Notifications from WorkItems.
7. Phase 6 — Cleanup legacy only after successful migration checks.
8. Phase 7 — Performance + Security + direct URL + ownership/unit scope + indexes/audit.
9. Phase 8 — Staging from Production backup, `prisma migrate deploy`, smoke, then release.

## شروط عدم التقدم

لا يتم تحويل PK/FK أو حذف CUID/Int/legacy fields قبل أن تكون لدينا:

- Production PostgreSQL backup.
- MinIO backup.
- uploads backup.
- checksum/format verification.
- isolated restore drill ناجح.
- baseline counts مهمة.
- migration/backfill idempotent.
- zero orphan checks.
- tests + typecheck + build.

## ملاحظات إضافية مسجلة للمرحلة اللاحقة

- `ApprovalRequest.amount` حالياً `Float?` ويجب مراجعته لأن الخطة تمنع Float للمبالغ المالية.
- لا يتم تحويل `Patient.fileNumber` إلى PK؛ يبقى رقم ملف مفهوم للمستخدم.
- `AuditLog` يبقى دائماً ولا يدخل في cleanup destructive.
- Prisma migrations القديمة تبقى كتاريخ قاعدة البيانات.
- routes القديمة تبقى redirect/deep-link compatibility إلى أن نصل cleanup منفصل ومختبر.

## الحالة الحالية

- Baseline code: **PASS**.
- Git isolation/worktree/branch: **PASS**.
- Plan-to-code audit: **PASS**.
- ID inventory: **PASS**.
- Existing backup tooling review: **PASS**.
- Live Production backup: **PENDING — no LAN access**.
- Backup verification: **PENDING**.
- Isolated restore drill: **PENDING**.
- GUID schema changes: **BLOCKED by Phase 0 gate**.
- Any destructive cleanup: **BLOCKED**.
