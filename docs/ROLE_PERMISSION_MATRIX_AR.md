# مصفوفة الأدوار والصلاحيات الفعلية — Tahili

> مصدر الحقيقة: `src/lib/perms.ts` و`src/lib/access.ts` ثم حراسة الصفحات وServer Actions. هذه المصفوفة توثق **الافتراضيات** في `ROLE_DEFAULTS` عند رأس المستودع `d634fae`. لا تحول الدور إلى وعد بصلاحية: التحميل الفعلي هو افتراض الدور ← تعديل `RolePermission` ← استثناء `UserPermission`، ثم تتحقق كل عملية خادميًا من `assertPerm` أو شرطها الخاص.

## قواعد القراءة

- `عرض` لا يعني إنشاء أو تعديل أو اعتماد. `requirePerm` يحول الصفحة غير المسموحة، و`assertPerm` يرفض الإجراء حتى مع تجاوز الواجهة.
- الحذف يتطلب دور `ADMIN` فعلياً و`assertAdminDelete()`، إضافة إلى المفتاح المناسب؛ مفاتيح الحذف موسومة `adminOnly`.
- المركز/القسم/الفرع وإسناد المراجع أو المعالج وحالة السجل قد تضيق الوصول أكثر، خصوصاً الجلسات والبرامج والملفات والتعاون.
- `ADMIN` يملك كل مفاتيح `ALL_PERMS` (139). بقية الصفوف أدناه هي اختصار للمفاتيح الفعلية لا قائمة تضمينية جديدة.

## الدور مقابل الصفحة الأساسية وأهم العمل

| الدور (الاسم الظاهر) | البداية اليومية الافتراضية | أهم المفاتيح الافتراضية |
| --- | --- | --- |
| ADMIN — مدير النظام | `/`, `/workspaces`, `/my-work` | جميع المفاتيح؛ مستخدمون، صلاحيات، إعدادات، تدقيق، نسخ |
| MANAGER — مدير إداري | `/my-work`, `/reports-finance` | تقارير/اعتمادات/مراكز/شراء/صرفيات؛ ليس إدارة مستخدمين |
| RECEPTION — استقبال | `/my-work`, `/patients-care?tab=visits` | مرضى، مواعيد، طابور، حضور، إجراءات رسمية |
| DATA_ENTRY — مدخل بيانات | `/my-work`, `/patients-care?tab=patients` | مرضى، مواعيد، طابور، حضور، نتائج/طباعة إحالة |
| RESIDENT — طبيب مقيم | `/my-work`, `/patients-care?tab=journey` | تشخيص، إحالات، جلسات/جروح/تقارير ضمن الافتراضي |
| DOCTOR — طبيب | `/my-work`, `/patients-care?tab=journey` | تشخيص، وصفة، رقود، إحالات ومراجعة نتائج |
| HEAD_THERAPIST — رئيس المعالجين | `/my-work`, `/therapy-centers?tab=plans` | خطة/جدولة/تقييم، برامج ومراكز، حمل المعالجين |
| THERAPIST — معالج | `/my-work`, `/therapy-centers?tab=today` | تسجيل الجلسة المسندة والتقدم والرعاية |
| PHARMACIST — صيدلي | `/my-work`, `/pharmacy-inventory?tab=dispense` | صرف، دفعات، مخزون، إنشاء/استلام شراء |
| ACCOUNTANT — شعبة مالية | `/my-work`, `/reports-finance?tab=finance` | فاتورة، دفعة، صرفية، سند، تقارير مالية |
| LAB — مختبر | `/my-work`, `/patients-care?tab=referrals` عند وجود override | عرض الملف/الحضور ومحطة التقارير فقط افتراضياً |
| RADIOLOGY — أشعة | `/my-work`, `/patients-care?tab=referrals` عند وجود override | عرض الملف/الحضور ومحطة التقارير فقط افتراضياً |
| DRESSING — تضميد | `/my-work`, `/patients-care?tab=journey` | تقييم جرح ورعاية/تضميد |
| PROSTHETICS — أطراف صناعية | `/my-work`, `/patients-care?tab=journey` | أجهزة: عرض، تسليم، صيانة |
| VIEWER — مشاهدة فقط | `/my-work`, `/patients-care?tab=patients` | عرض واسع محدود، مهمة/تعاون؛ الاسم لا يمنع التنفيذ إن كان المفتاح موجوداً |

## من ينشئ ومن يعدّل ومن يعتمد ومن يطبع

| المجال | إنشاء/تعديل وفق المفتاح | اعتماد/تنفيذ | طباعة | قيد حساس |
| --- | --- | --- | --- | --- |
| المراجع | `patients.create`, `patients.edit` | لا يوجد اعتماد عام | `patients.print` | الحذف `patients.delete` + ADMIN |
| الموعد/الحضور/الطابور | `appointments.create/edit`, `visits.manage`, `queue.manage` | تغيير الحالة محروس بالإجراء | — | حذف الموعد/مدخلات الطابور ADMIN |
| السجل السريري | `clinical.*` حسب العنصر | اعتماد تقرير `reports.approve` | `reports.print` | الحذف ADMIN، وقفل الخطة المكتملة `therapy.admin.override` |
| الإحالة | `referrals.create/updateStatus/recordResult` | `reviewResult` أو `accept` حسب المسار | `referrals.print` | الانتقالات تثبتها خدمة الإحالة |
| العلاج/المركز | `therapy.plan.manage`, `centers.programs.manage` | `therapy.plan.finalize`, `centers.programs.finalize` | `reports.print` عند توفره | العضوية والإسناد وحالة الخطة |
| الصيدلية | `pharmacy.dispense`, `pharmacy.batch`, `inventory.manage`, `pharmacy.purchase.create`, `pharmacy.purchase.receive` | `pharmacy.purchase.approve` | `pharmacy.print` | السعر `pharmacy.purchase.prices`، override ADMIN |
| المالية | `finance.invoice/payment`, `expenses.create/submit` | `expenses.approve/pay`, `approvals.*` | `finance.receipt`, `expenses.print` | المبالغ `expenses.amounts`، الحذف ADMIN |
| الإدارة | `settings.edit`, `users.manage`, `users.permissions` | — | — | المستخدمون/الصلاحيات والتدقيق والنسخ حسب المفاتيح وADMIN حيث موسوم |

## الصلاحيات الحساسة والحصرية

| الحالة | المفتاح أو الحارس | الافتراضي ذي الصلة |
| --- | --- | --- |
| حذف أي سجل محمي | `assertAdminDelete()` + مفتاح الحذف | ADMIN فقط |
| تجاوز قفل خطة/جلسة مكتملة | `therapy.admin.override` | ADMIN فقط |
| حذف نهائي للملف/إدارة خدمة الملفات | `files.delete.permanent`, `files.admin` | ADMIN فقط |
| إدارة حساب/كلمة مرور/تفعيل وصلاحية | `users.manage`, `users.permissions` | ADMIN فقط |
| قراءة التدقيق | `audit.view` | ADMIN فقط |
| النسخ والاستعادة | `settings.backup` مع حراس إجراءات النسخ | ADMIN افتراضياً |
| مبالغ الصرفيات | `expenses.amounts` | ADMIN، MANAGER، ACCOUNTANT |
| اعتماد شراء | `pharmacy.purchase.approve` | ADMIN، MANAGER |
| سعر الشراء | `pharmacy.purchase.prices` | ADMIN، MANAGER فقط افتراضياً |
| اعتماد التقرير | `reports.approve` | ADMIN، MANAGER |

## المصفوفة الكاملة للـ139 مفتاحاً

المفتاح المتاح افتراضياً يُشتق بدقة من القوائم المسماة في `src/lib/perms.ts`: `ADMIN=ALL_PERMS`; ثم `MANAGER_DEFAULT`, `DOCTOR_DEFAULT`, `THERAPIST_DEFAULT`, `ACCOUNTANT_DEFAULT`, `PHARMACIST_DEFAULT`, `VIEWER_DEFAULT`, `RECEPTION_DEFAULT`, `DATA_ENTRY_DEFAULT`, `RESIDENT_DEFAULT`, `HEAD_THERAPIST_DEFAULT`, و`LAB/RADIOLOGY/DRESSING/PROSTHETICS_DEFAULT`. لمنع جدول غير قابل للقراءة يكرر 139 خانة، هذا هو الملحق القابل للتدقيق حسب العائلات:

| عائلة المفاتيح | الأدوار الافتراضية ذات الصلة |
| --- | --- |
| `dashboard.*`, `patients.view`, `appointments.view`, `queue.view`, `visits.view`, `tasks.view/create/complete`, `journey.view/confirm`, `officialdocs.view`, `approvals.view/create`, `sickleave.view`, التعاون الأساسي | جميع الأدوار، بما فيها VIEWER، عبر `VIEWER_DEFAULT` أو `STATION_BASE` أو قوائمها الخاصة |
| `patients.create/edit/print/portal`, `appointments.create/edit`, `queue.manage`, `visits.manage` | RECEPTION، DATA_ENTRY؛ كما تظهر في THERAPIST/RESIDENT/DOCTOR/HEAD_THERAPIST/MANAGER/ADMIN عبر الوراثة |
| `patients.archive/import/export`, `clinical.diagnosis/prescription/admission`, `beds.*` | DOCTOR، MANAGER، ADMIN؛ التشخيص فقط يضاف لـRESIDENT |
| `clinical.session/metrics/plan/report/wound/care`, `therapy.view/session.record/improvement.update` | THERAPIST وRESIDENT/DOCTOR/MANAGER/ADMIN؛ DRESSING يملك `clinical.wound/care` فقط من هذه العائلة |
| `therapy.plan.manage/finalize/evaluation.periodic/specialist.assign/schedule.reschedule`, `centers.programs.*`, `workload.view` | HEAD_THERAPIST؛ بعض النهائي/الاختصاص/العمل أيضاً DOCTOR/MANAGER/ADMIN وفق القائمة |
| `referrals.*` | DOCTOR كامل عدا الطباعة الافتراضية؛ RESIDENT create/update/result/cancel؛ DATA_ENTRY view/print/update/result؛ HEAD_THERAPIST view/accept؛ MANAGER view/print/update؛ ADMIN كامل |
| `pharmacy.*`, `inventory.*` | PHARMACIST؛ MANAGER/ADMIN أوسع، والأسعار/اعتماد الشراء ليست افتراضية للصيدلي |
| `finance.*`, `expenses.*` | ACCOUNTANT؛ MANAGER/ADMIN: يعتمدون الصرفيات ولا يملكون افتراضياً إنشاء فاتورة/دفعة أو مسودة صرفية |
| `reports.approve`, `approvals.review/approve/execute` | DOCTOR يراجع؛ MANAGER يعتمد/ينفذ؛ ADMIN الجميع؛ ACCOUNTANT ينشئ طلباً فقط |
| `centers.memberships.manage`, `centers.resources.manage`, `centers.psych.sensitive` | HEAD_THERAPIST/ MANAGER/ADMIN ضمن نطاق العضوية حيث ينطبق |
| `settings.*`, `users.*`, `audit.view`, `files.admin`, `files.delete.permanent` | ADMIN فقط افتراضياً |

## الفرق بين العرض والتنفيذ والاعتماد

| المستوى | معناه | مثال |
| --- | --- | --- |
| عرض | يرى الصفحة أو السجل إن مرّ حارس الصفحة والنطاق | `referrals.view` لا يتيح تغيير حالة |
| إنشاء/تعديل | يرسل Action محروساً بمفتاح محدد | `expenses.create` أو `appointments.edit` |
| اعتماد/تأكيد | انتقال أعلى في دورة العمل | `reports.approve`, `expenses.approve`, `therapy.plan.finalize` |
| حذف/تجاوز | خطر أعلى ويتطلب ADMIN حيث يطبق الحارس | `assertAdminDelete`, `therapy.admin.override` |
