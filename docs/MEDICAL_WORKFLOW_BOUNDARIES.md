# Medical Workflow Boundaries

هذا المرجع يحدد حدود تحسين الواجهة. المصدر النهائي للحالات والانتقالات هو الكود المشار إليه، وليس هذا الملخص. لا تغيّر أي دورة بحجة تقليل النقرات أو توحيد الشاشة.

## Contract

### UI قابل للتعديل

- ترتيب العرض، المسافات، العناوين، المكونات المشتركة، الجداول، الفلاتر والحالات الفارغة.
- تنظيم navigation والـtabs والـdeep links مع إبقاء routes القديمة والإجراءات ظاهرة.
- تحسين RTL والهاتف والوضع الداكن والوصول دون تغيير payload أو معنى الحقل.
- إظهار الحالة الموجودة بوضوح أكبر دون إنشاء حالة جديدة أو اشتقاق قرار طبي.

### منطق ممنوع

- البيانات والحقول الطبية ومعناها، التشخيص، التقرير، الوصفة، الجرح والعلامات الحيوية.
- state machines وانتقالات الأدوار والصلاحيات وعضوية المركز والعزل بين الفروع.
- الأهلية العلاجية أو الدوائية، FEFO، الصرف الذري، الموافقات والمبالغ والتدقيق.
- حذف route أو Server Action أو وظيفة، أو دمج واجهات يخفي إجراءً أو deep link.
- Prisma schema أو migration أو seed أو بيانات تشغيلية.

## Workflow Map

| # | الدورة | المنشئ والمسؤول | الحالات/الانتقال | الملفات وActions الحاكمة | صفحات العرض | UI مسموح / منطق ممنوع |
| ---: | --- | --- | --- | --- | --- | --- |
| 1 | تسجيل المراجع | `DATA_ENTRY`/الاستقبال؛ المسؤول مدخل البيانات | إنشاء، منع تكرار، تعديل، أرشفة/استعادة | `patients/actions.ts`, `validate.ts`, `branch-context.ts` | `/patients/new`, `/patients`, `/patients/[id]/edit`, `/patients-care` | تنسيق النموذج والرسائل؛ ممنوع تغيير تعريف الحقول أو منع التكرار والأرشفة |
| 2 | الزيارة والحضور | `RECEPTION`؛ مسؤول الاستقبال | check-in ثم Visit وCareStage وفق الوجهة | `visits/actions.ts`, `queue.ts`, `audit.ts` | `/visits`, `/patients-care?tab=visits`, ملف المراجع | تحسين البحث والجدول؛ ممنوع تغيير إنشاء الزيارة أو deduplication |
| 3 | الطابور | الاستقبال؛ محطة الرعاية | `WAITING → CALLED → IN_SESSION → DONE` مع الإلغاء وفق الحراسة | `queue/actions.ts`, `queue.ts`, `/api/queue/today` | `/queue`, `/patients-care?tab=queue`, `/display` | عرض الحالة والفلاتر؛ ممنوع تغيير الترتيب والانتقالات والمحطة |
| 4 | محطة الطبيب المقيم | `RESIDENT`; يتابع `DOCTOR` | تقييم أولي ثم جاهزية المرحلة التالية | `PatientTabs.tsx`, `patients/actions.ts`, `patient-journey.ts` | `/patients/[id]`, `/my-work`, `/care-board` | ترتيب الأقسام؛ ممنوع تغيير قرار الجاهزية أو الحقول السريرية |
| 5 | العلامات الحيوية والجروح | المقيم/التضميد حسب الصلاحية | سجلات زمنية مرتبطة بالمراجع | `PatientTabs.tsx`, `patients/actions.ts`, `CareSection.tsx` | ملف المراجع وسجل الطباعة | مكونات إدخال وعرض؛ ممنوع معنى القياسات والتقييمات أو تاريخها |
| 6 | الاختصاص والاستشارية | `DOCTOR`; الإحالة لمراجع/مركز مختص | DRAFT/READY/ACCEPTED أو دورة خارجية | `referral-workflow.ts`, `referral-service.ts`, `referrals/actions.ts` | `/referrals`, `/referrals/[id]`, ملف المراجع | status presentation؛ ممنوع الدور أو transition أو reviewer binding |
| 7 | التشخيص والتقارير والوصفات | الطبيب/المقيم بحسب الصلاحية | مسودة/جاهز للطباعة/اعتماد حسب السجل | `patients/actions.ts`, `reports/official/actions.ts`, `pharmacy/actions.ts` | ملف المراجع، `/reports*`, `/pharmacy/rx/[id]` | المحرر والطباعة؛ ممنوع المحتوى الطبي والأهلية والقفل |
| 8 | المختبر والأشعة | طبيب ينشئ؛ بيانات/مختص يسجل؛ طبيب يراجع | دورة الإحالة الخارجية حتى `REVIEWED` | `referral-workflow.ts`, `referral-service.ts` | `/referrals*`, `/patients-care?tab=referrals`, `/my-work` | التفريق البصري؛ ممنوع المستند الرسمي وتسلسل النتيجة والمراجعة |
| 9 | الإحالات الداخلية والخارجية | `RESIDENT/DOCTOR`; الإدارة تطبع/ترسل؛ الطبيب يراجع | خارجي: `DRAFT→PENDING_PRINT→READY→SENT→RESULT_RECEIVED→REVIEWED`; داخلي: `DRAFT→READY→ACCEPTED`; `CANCELLED` نهائية | `referral-workflow.ts`, `referral-service.ts`, `referrals/actions.ts` | `/referrals`, التفاصيل، الكتاب الرسمي، journey | timeline وCTA placement؛ ممنوع أي transition/permission/side effect |
| 10 | الرقود والأسرة | مخول سريري؛ إدارة الأسرة | تخصيص سرير، منع تعارض، خروج، إعادة تخصيص | `beds/actions.ts`, `patients/actions.ts` | `/beds`, ملف المراجع، قرار الرقود | grid واستجابة الهاتف؛ ممنوع occupancy والتعارض والخروج |
| 11 | الخطط العلاجية | `HEAD_THERAPIST`; المعالج مسؤول عن التنفيذ | DRAFT/ACTIVE/COMPLETED/CANCELLED وفق قواعد الخطة | `therapy/actions.ts`, `therapy-plan-rules.ts` | `/therapy`, `/therapy-centers`, ملف المراجع | تنظيم الخطة؛ ممنوع المالك والمدة والحالات وقواعد التفعيل |
| 12 | الجلسات والتقييمات | رئيس المعالجين يسند؛ `THERAPIST` يسجل؛ الرئيس يعتمد النهائي | scheduled/completed والنتيجة والتقييم النهائي | `therapy/actions.ts`, `therapy-plan-rules.ts`, `center-access.ts` | `/therapy/today`, `/centers/[slug]/today`, `/therapy/plans/[id]/final` | قائمة اليوم والنماذج؛ ممنوع عضوية المركز والنتيجة والحالات |
| 13 | المراكز والقاعات | الإدارة/رئيس المعالجين؛ النطاق بالعضوية | برامج وموارد وقاعات ضمن المركز | `centers/actions.ts`, `center-access.ts`, `center-halls.ts`, `center-workspaces.ts` | `/centers*`, `/therapy-centers` | layout وfilters؛ ممنوع center isolation والعضوية والتخصيص |
| 14 | الشراء والدفعات | الصيدلي ينشئ؛ المخول يعتمد ويستلم | أمر شراء ثم اعتماد واستلام ودفعات | `pharmacy/purchases/actions.ts`, schema stock models | `/pharmacy/purchases*`, `/pharmacy-inventory` | الجدول والتقارير؛ ممنوع الأسعار المخفية والموافقة وكميات الدفعات |
| 15 | صرف الصيدلية | الطبيب يصف؛ الصيدلي يصرف | أهلية ثم queue ثم صرف ذري FEFO وقفل | `pharmacy/actions.ts`, `DispenseQueue.tsx` | `/pharmacy`, `/pharmacy/patient/[id]`, ملف المراجع | queue وbadges؛ ممنوع الأهلية وFEFO والمخزون وidempotency |
| 16 | المالية والموافقات | محاسب ينشئ؛ مستويات إدارية تعتمد؛ محاسب يدفع/يعكس | draft/approval levels/approved/paid/reversed أو rejected | `finance/actions.ts`, `finance/expenses/actions.ts`, `expense-approval.ts` | `/finance*`, `/approvals`, `/reports-finance` | عرض الأرقام عند الصلاحية؛ ممنوع المبلغ والمستوى والقيد والعكس |
| 17 | المخاطبات والإجراءات الرسمية | مخول إداري/طبي؛ الاعتماد حسب الوثيقة | وارد/صادر، مستند رسمي، إجازة ومرفقات | `official-docs/actions.ts`, `patients/actions.ts`, `audit.ts` | `/official-docs*`, ملف المراجع، صفحات الطباعة | محرر وفهرسة؛ ممنوع هوية الوثيقة واعتمادها وربطها |
| 18 | `my-work` | لا ينشئ بيانات؛ يجمع للمستخدم الحالي | view model مشتق حسب الصلاحية والحالة | `my-work.ts`, `work-registry.ts`, `role-workspaces.ts` | `/my-work`, `/workspaces`, `/` | ترتيب وبطاقات وفلاتر؛ ممنوع إضافة صلاحية أو حالة أو مهمة ضمنية |
| 19 | patient journey والتنبيهات | journey مشتقة؛ المنتج الوظيفي ينشئ Notification | journey من السجلات القائمة؛ الروابط تُفلتر بالصلاحية | `patient-journey.ts`, `notifications.ts`, `notif-actions.ts`, `notify.ts` | ملف المراجع، `/notifications`, AppShell | timeline ومركز التنبيه؛ ممنوع اختراع stage أو كشف رابط غير مصرح |
| 20 | AuditLog | كل Action حساس يكتب؛ الإدارة تقرأ | append-only للأثر قبل/بعد | `audit.ts` وActions الحاكمة | `/audit`, readiness وتقارير محددة | فلاتر وعرض؛ ممنوع حذف الأثر أو تقليل الكتابة أو كشف القيم الحساسة |

## Required Guardrails

قبل commit لأي UI متصل بهذه الدورات:

1. سجل baseline للسلوك والroutes والـdeep links وServer Actions.
2. طابق role/permission matrix ولا تستنتج الصلاحية من إخفاء الزر.
3. اختبر direct URL للدور غير المخول، ومسار الدور المخول.
4. اختبر الحالة قبل وبعد والـDB side effect نفسه، دون تعديل fixture لتجاوز فشل التطبيق.
5. شغّل TypeScript والاختبارات المستهدفة وفحص desktop/mobile/RTL/dark.
6. أوقف التغيير إذا احتاج تعديل schema أو Action أو state machine؛ افصله كتغيير وظيفي مستقل.
