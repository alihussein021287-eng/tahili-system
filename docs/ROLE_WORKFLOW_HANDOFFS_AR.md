# خريطة تسليم العمل بين الأدوار — Tahili

> هذه خريطة تشغيلية وليست وصفاً طبياً. تنتقل الحالة فقط عبر Actions وخدمات النظام المحروسة؛ لا يجوز استخدام الدليل لتجاوز حالة أو صلاحية. نقطة الإغلاق هي ما يثبته الكود أو الوثائق المرجعية، لا قرار موظف فردي.

| الدورة | المسار المثبت |
| --- | --- |
| تسجيل المراجع والحضور | الاستقبال/مدخل البيانات → `patients.create/edit` أو `visits.manage` → الطابور عند توفر `queue.manage` → زيارة/محطة تالية → تسجيل الحضور أو إدخاله للطابور |
| الزيارة والطابور | حضور مراجع → RECEPTION/DATA_ENTRY أو مخول → `queue.manage` → RESIDENT/DOCTOR أو محطة العمل → الحالة تسجل في `QueueEntry` |
| المقيم والعلامات والجروح | طابور/ملف → RESIDENT أو مخول → `clinical.diagnosis`، وعند منحه المفاتيح المناسبة `clinical.wound/metrics` → DOCTOR/إحالة/علاج → السجل المحفوظ، وليس نصيحة طبية |
| الاختصاص والاستشارية | إحالة أو ملف → DOCTOR → تشخيص/وصفة/رقود/مراجعة نتيجة حسب المفاتيح → صيدلية/مختبر/أشعة/مركز/تقرير → Action محروس وحالة السجل |
| الفحوص والإحالات | DOCTOR/RESIDENT → `referrals.create` → DATA_ENTRY/MANAGER للطباعة أو تحديث الإرسال حسب المفاتيح → LAB/RADIOLOGY أو الجهة الداخلية → `recordResult` ثم DOCTOR `reviewResult` → `REVIEWED` خارجيًا أو `ACCEPTED` داخليًا؛ الإلغاء `CANCELLED` نهائي |
| الوصفات | DOCTOR أو مخول `clinical.prescription` → وصفة → PHARMACIST `pharmacy.dispense` (وجزئي فقط مع `pharmacy.dispense.partial`) → مخزون/دفعة → حالة الصرف الذرية |
| الصيدلية والمخزون والشراء | حاجة مخزون → PHARMACIST `pharmacy.purchase.create` → MANAGER/ADMIN `pharmacy.purchase.approve` → PHARMACIST `pharmacy.purchase.receive` → دفعات/مخزون → سجل الاستلام؛ الأسعار لا تعرض بلا `pharmacy.purchase.prices` |
| الرقود والفندقة وأدوية الراقدين | DOCTOR أو مخول `clinical.admission` → `beds.assign` → سرير → مخول `meds.manage` يسجل الجرعات → خروج/تحديث رقود وفق Action → الإشغال الصحيح |
| العلاج الطبيعي | إحالة/خطة → HEAD_THERAPIST `therapy.plan.manage` والجدولة/الإسناد → THERAPIST المسند وعضو المركز `therapy.session.record` → رئيس المعالجين/مخول `therapy.plan.finalize` → خطة نهائية وفق الحالة |
| التأهيل النفسي | إحالة داخلية → HEAD_THERAPIST/عضو مخول `centers.programs.manage` → جلسة/تقييم مركز → مخول نهائي `centers.programs.finalize` → برنامج منتهٍ؛ الملاحظة الحساسة تتطلب `centers.psych.sensitive` |
| العلاج الوظيفي | برنامج مركز → رئيس/مخول يدير الموارد والقاعة → معالج عضو يسجل الجلسة → رئيس/مخول ينهي البرنامج → لا يعبر المركز بلا عضوية |
| مركز النقاء | إحالة/برنامج → عضو المركز المخول → الموارد والجلسات في مساحة المركز → تقييم/نهاية البرنامج → النطاق محفوظ بـCenterMembership |
| التقارير والإجراءات الرسمية | ملف/طلب → DOCTOR أو مخول `clinical.report`/`officialdocs.manage` → تقرير أو مستند → MANAGER/ADMIN عند `reports.approve` → `reports.print` أو صفحة الطباعة → التقرير/المستند المعتمد |
| الصرفيات والاعتمادات | ACCOUNTANT `expenses.create` → `expenses.submit` → MANAGER/ADMIN `expenses.approve` → ACCOUNTANT `expenses.pay` → سند `expenses.print` → مدفوع/مصحح وفق الحالة؛ المبلغ يحتاج `expenses.amounts` |
| المهام والحضور والشفتات | منشئ مخول `tasks.create` أو `shifts.manage` → الموظف `tasks.complete` أو يسجل الحضور عند `attendance.manage` → MANAGER/ADMIN `shifts.approve` → المهمة/الطلب بحالته المسجلة |
| التعاون والدردشة والملفات | مستخدم مخول → محادثة/رسالة/رفع (`chat.*`, `files.*`) → مشاركة ضمن القسم/المركز وبعد فحص الملف SAFE → المستلم المخول → إغلاق المشاركة أو إدارة المشرف؛ لا فتح قبل الفحص |
| التنبيهات والمتابعة | Action وظيفي ينشئ Notification → المستخدم المستهدف → `/notifications` → الرابط يمر `canOpenNotification` → فتح الرابط أو بقاؤه مخفياً |
| المستخدمون والإعدادات والنسخ والجاهزية | ADMIN → `users.manage/users.permissions/settings.*` → ضبط/تدقيق/نسخ → Admin أو إجراء إدارة آخر → أثر AuditLog وإتمام العملية؛ لا تسليم تشغيلي لدور عادي |

## قاعدة التصعيد

فشل الحفظ أو غياب المفتاح أو عدم ظهور مركز/قاعة ليس سبباً لتبديل الدور أو طلب تجاوز. يوثق الموظف رقم السجل غير الحساس ورسالة الخطأ، ثم يصعّد لمالك المرحلة: رئيس المعالجين للمركز والجلسة، الطبيب للملف/الإحالة، المدير للاعتماد التشغيلي، وADMIN للمستخدمين والصلاحيات والإعدادات والنسخ والحذف الحصري.
