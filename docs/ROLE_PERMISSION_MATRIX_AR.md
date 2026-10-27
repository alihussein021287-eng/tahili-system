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
| RECEPTION — استقبال | `/my-work`, `/patients-care?tab=visits` | مراجعون موجودون (عرض/تعديل/طباعة)، مواعيد، حضور، طابور، وتسليم للمحطة التالية؛ لا ينشئ ملفاً ولا يدخل السجل السريري أو الإجراءات الرسمية |
| SECRETARY — سكرتارية | `/my-work`, `/patients-care?tab=visits` | مراجعون موجودون (عرض/تعديل/طباعة)، مواعيد، طباعة/تحديث إرسال الإحالة، تعاون أساسي، وتسليم؛ الحضور والطابور للعرض فقط، وبلا إنشاء ملف أو صلاحيات طبية |
| DATA_ENTRY — مدخل بيانات | `/my-work`, `/patients-care?tab=patients` | إنشاء/تعديل/طباعة الملف، مواعيد، طباعة/إرسال/تسجيل نتيجة الإحالة، وتسليم الملف؛ سجل الحضور والطابور للعرض فقط |
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

`/observability` ملخص تشغيلي read-only حصري لدور `ADMIN` بحارس خادمي صريح، مع أن الرابط يستخدم `settings.view` في registry للاتساق فقط. لا يمنح مفتاحاً جديداً ولا يفتح للأدوار الأخرى أو يعرض سجلات/traces/معرّفات خام.

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
| `dashboard.*`, `patients.view`, `appointments.view`, `queue.view`, `visits.view` | أدوار التشغيل حسب قائمتها الصريحة؛ الاستقبال يملك هذه المفاتيح فقط ضمن نطاق عمله، وليس بالضرورة مفاتيح المهام أو الرحلة أو الموافقات أو التعاون |
| `patients.create/edit/print/portal`, `appointments.create/edit` | DATA_ENTRY ينشئ/يعدل/يطبع الملف والمواعيد، بلا portal؛ SECRETARY يحتفظ بنطاقه الإداري المستقل؛ THERAPIST/HEAD_THERAPIST يملكان تعديل الملف وطباعة ما يلزم دون إنشاء ملف أو حجز موعد افتراضياً؛ RESIDENT/DOCTOR لا يملكان إنشاء الملف أو حجز المواعيد افتراضياً؛ MANAGER/ADMIN حسب قائمتهما؛ RECEPTION يملك edit/print والمواعيد فقط، ولا يملك create أو portal |
| `queue.manage` (إضافة/استدعاء/تحريك الطابور) | RECEPTION وADMIN فقط؛ أما بقية الأدوار فلديها `queue.view` للعرض دون إدارة |
| `visits.manage` (تسجيل حضور المراجع) | RECEPTION وADMIN فقط؛ أما بقية الأدوار فلديها `visits.view` للعرض دون تسجيل حضور |
| `handoff.send/receive` | RECEPTION، DATA_ENTRY، SECRETARY، DOCTOR، RESIDENT، HEAD_THERAPIST، THERAPIST، MANAGER، ADMIN |

تملك أدوار الاستقبال ومدخل البيانات والسكرتارية التعاون الأساسي للتنسيق (`collaboration.view`, `chat.create`, `chat.send`) والملفات ضمن النطاق (`files.view/upload/download/edit/share`). لا تملك افتراضياً إدارة الأعضاء أو الإشراف أو حذف/استعادة الملفات؛ وتبقى مشاركة ملفات المراجعين محكومة بصلاحية رؤية المستلمين ونطاق المركز/القسم.

تتبع السكرتارية (`SECRETARY`) تسليمات المركز بصلاحيات `handoff.send` و`handoff.receive`، مع بقاء حدودها السريرية كما هي. حدود التأخير حسب دور المستلم: SECRETARY وRECEPTION وDATA_ENTRY: 20 دقيقة؛ RESIDENT: 30؛ DOCTOR: 45؛ HEAD_THERAPIST: 240؛ THERAPIST: 4320 دقيقة (3 أيام). التسليم بين مركزين مختلفين: 1440 دقيقة (24 ساعة). هذه حدود تنبيه للمتابعة وليست تغييراً تلقائياً للحالة.
| `patients.archive/import/export`, `clinical.diagnosis/prescription/admission`, `beds.*` | DOCTOR يملك التشخيص والوصفة والرقود والأسرة دون إنشاء/أرشفة/استيراد/تصدير الملف؛ MANAGER وADMIN حسب قائمتهما؛ التشخيص فقط يضاف لـRESIDENT |
| `clinical.session/metrics/plan/report/wound/care`, `therapy.view/session.record/improvement.update` | THERAPIST يملك التنفيذ العلاجي؛ RESIDENT يملك الجلسات/المقاييس/الخطة/التقارير/الجروح/الرعاية اللازمة للمتابعة دون `therapy.session.record`؛ DOCTOR يملك التقييم والخطة والقرار الطبي دون تنفيذ جلسات المعالج؛ HEAD_THERAPIST يدير الخطة ولا يسجل الجلسة التنفيذية؛ DRESSING يملك `clinical.wound/care` فقط من هذه العائلة |
| `therapy.plan.manage/finalize/evaluation.periodic/specialist.assign/schedule.reschedule`, `centers.programs.*`, `workload.view` | HEAD_THERAPIST؛ بعض النهائي/الاختصاص/العمل أيضاً DOCTOR/MANAGER/ADMIN وفق القائمة |
| `referrals.*` | DOCTOR view/create/update/review/accept/cancel؛ RESIDENT view/create/update/result/cancel؛ DATA_ENTRY view/print/update/result؛ HEAD_THERAPIST view/accept؛ MANAGER view/print/update؛ ADMIN كامل |
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

> مخزون مستقل لكل فرع: صلاحيات `pharmacy.*` و`inventory.*` لا تكفي وحدها للصرف أو الاستلام؛ يلزم فرع فعّال للمستخدم يطابق فرع منشأ الوصفة/أمر الشراء. ADMIN للقراءة عبر الفروع فقط.

> قرار 2026-10-19: `reports.print` لـ DOCTOR وRESIDENT وSECRETARY وMANAGER وADMIN (ضمن نطاق الفرع/العلاقة، بحالة جاهز للطباعة، مع تدقيق)؛ الاعتماد `reports.medical.approve` للمدير والأدمن فقط؛ التعديلات المالية مقيّدة بفرع المستخدم الفعّال؛ القراءة التاريخية للسجلات المؤلَّفة عبر `/my-work/authored` بعد تسليم مكتمل. التفاصيل: `docs/decisions/2026-10-19-approved-v1-policies.md`.

> قرار 2026-10-20: الوصفة تُربط بزيارة صريحة دون سقف 48 ساعة (السياق القائم عبر تسليم حيّ/رقود/زيارة اليوم وعدم تجاوزها بزيارة أحدث)؛ الفواتير المرتبطة بزيارة يملكها مالياً فرع الاستقبال. التفاصيل: `docs/decisions/2026-10-20-visit-eligibility-and-cross-branch-finance.md`.

## مركز استيراد وتصدير البيانات (09.1)
| الصلاحية | الافتراضي | الأثر |
| --- | --- | --- |
| `datacenter.view` | ADMIN | فتح المركز والسجل والقوالب |
| `datacenter.import.patients/personnel/accounts/memberships` | ADMIN | معاينة استيراد النوع المقابل (فرع المستخدم) |
| `datacenter.import.apply` | ADMIN | تنفيذ الاستيراد (مقفل في بيئة QA/المعاينة) |
| `datacenter.export.*` | ADMIN | تصدير النوع المقابل ضمن نطاق الفرع؛ المالي يتطلب `finance.report` أيضاً |

## سجلات الموظفين (09.3)
| الصلاحية | الافتراضي | الأثر |
| --- | --- | --- |
| `employees.view` | ADMIN | عرض سجلات الموظفين وأعدادها ضمن فرع المستخدم |
| `employees.edit` | ADMIN | تعديل الحقول المصرّح بها لسجلات الفرع (الفرع نفسه للأدمن فقط) |
| `users.manage` (ADMIN) | ADMIN | ربط حساب موجود أو تجهيز حساب معطّل من ملف الموظف |

## إضافة V1 المحلية — 2026-10-27
| المفتاح | حدود التنفيذ |
| --- | --- |
| clinical.review.nominate | default deny؛ SECRETARY فقط مع UserPermission فردي صريح وعضوية SECRETARY فعالة ونطاق المراجع؛ الدور أو رحلة التوجيه لا يكفيان |
| clinical.review.accept | DOCTOR فقط، تعيين باسمه وعضوية SPECIALIST فعالة ونطاق المراجع، دون ADMIN/MANAGER بديل |
| centers.programs.medicalConfirm | DOCTOR مقبول بتعيين برنامج مستقل، بعد إنجاز HEAD_THERAPIST، مع الصلاحية والنطاق والعضوية الحالية |
| centers.programs.finalize | لإنجاز CenterProgram التشغيلي الجديد: HEAD_THERAPIST حصراً؛ التأكيد الطبي مستقل. لا تغيير لعقد TreatmentPlan |
الترشيح والسحب والقبول والتأكيد مدققة؛ لا منح تلقائي للسكرتارية. المرجع V1_CLINICAL_RELEASE_AR.md.
