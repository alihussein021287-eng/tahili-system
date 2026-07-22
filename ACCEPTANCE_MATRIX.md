# Acceptance Matrix

مصفوفة قابلة للتحديث بعد كل فحص شامل. استخدم بيانات موسومة `ACCEPTANCE` أو `e2e` فقط عند الحاجة، ولا تنظفها إلا بسكربت dry-run ثم تنفيذ صريح.

| الدورة | المستخدم/الدور | بيانات مطلوبة | خطوات مختصرة | نتيجة متوقعة | tests/routes |
| --- | --- | --- | --- | --- | --- |
| تسجيل الدخول والصلاحيات | Admin ومستخدم محدود | حسابات نشطة ومعطلة | تسجيل دخول، فتح صفحات مسموحة وممنوعة، تبديل دور/صلاحية | دخول صحيح، منع غير المخول، لا 500 | `tests/unit/perms.test.ts`, `/login`, `/permissions` |
| مصفوفة الوصول | Admin | إعدادات البيئة فقط | domain HTTPS وIP HTTP، callback، reload، logout | cookies منفصلة host-only، رفض Host غير معروف، الفحص الحي عبر IP | `environment-access.test.ts`, `ENVIRONMENTS.md` |
| الاستقبال/الحضور | `RECEPTION` | مراجع QA | بحث، تسجيل حضور، تحديث بيانات، فتح ملف | زيارة مسجلة وتظهر في الرعاية | `/patients-care?tab=visits`, `/patients/[id]` |
| الطابور | استقبال/طبيب | زيارة نشطة | إضافة للطابور، استدعاء، إدخال جلسة، إنهاء | الحالة تنتقل بدون تكرار | `queue*`, `/patients-care?tab=queue` |
| الطبيب المقيم | `RESIDENT` | مراجع مع زيارة | فتح الملف، تشخيص، إحالة، وصفة حسب الصلاحية | السجلات تحفظ وتظهر في الملف | `/patients/[id]`, referrals tests |
| الطبيب الاختصاص | `DOCTOR` | خطة أو تقرير | مراجعة الخطة، تقرير طبي، اعتماد مناسب | لا تظهر أدوات غير مخولة | `/reports-finance?tab=patients` |
| الإحالات | طبيب/استقبال | طلب إحالة QA | إنشاء، طباعة، إرسال، تسجيل نتيجة، مراجعة | حالة الطلب صحيحة والكتاب يعمل | `acceptance-referrals`, `/patients-care?tab=referrals` |
| الوصفات | طبيب/صيدلي | وصفة داخلية | إنشاء وصفة، صرف كلي/جزئي، رفض عند نقص صلاحية | المخزون والحالة يتحدثان | `acceptance-pharmacy`, `/pharmacy-inventory?tab=dispense` |
| التقارير الطبية | طبيب/مدير | تقرير مراجع | إنشاء/فلترة/طباعة | التقرير يظهر حسب الصلاحية | `/reports-finance?tab=patients` |
| الرقود والفندقة | طبيب/مدير | سرير ومراجع | رقود، تخصيص سرير، خروج/تمديد | إشغال السرير صحيح | `/therapy-centers?tab=beds` |
| العلاج الطبيعي | `HEAD_THERAPIST`/`THERAPIST` | خطة وجلسات | إنشاء خطة، جدولة، تسجيل جلسة، تقييم نهائي | النطاق حسب العضوية والمعالج | `therapy*`, `/therapy-centers` |
| التأهيل النفسي | رئيس مركز/معالج | برنامج مركز | قبول إحالة، تسجيل تقييم وجلسات، فحص الملاحظات الحساسة | الملاحظات الحساسة مخفية دون صلاحية | `acceptance-centers`, `/therapy-centers?tab=centers` |
| العلاج الوظيفي | معالج/رئيس مركز | برنامج وقاعة | جدولة جلسة، تغيير قاعة، تسجيل حضور | القاعات والمراكز لا تتداخل | `center-halls`, `/centers/[slug]` |
| مركز النقاء | مستخدم مركز | عضوية مركز | فتح مساحة المركز، الموارد، البرامج | يظهر المركز المسموح فقط | `/therapy-centers?tab=centers` |
| الصيدلية والمخزون | `PHARMACIST`/مدير | أدوية ودفعات | فحص stock/batches/purchases/reports | أسعار الشراء تظهر لصلاحيتها فقط | `/pharmacy-inventory` |
| المالية والصرفيات | `ACCOUNTANT`/مدير | فاتورة وصرفية | فاتورة، دفعة، صرفية، اعتماد، سند | المبالغ لا تظهر دون `expenses.amounts` | `expense-approval`, `/reports-finance` |
| التعاون والملفات | مستخدم تعاون/Admin | ملف QA آمن | رفع، scan، مشاركة، معاينة، تنزيل | ClamAV/MinIO يعملان، غير الآمن لا يفتح | `collaboration-rules`, `/collaboration/files` |
| التنبيهات | أي دور | إشعار مستهدف | فتح مركز التنبيهات والرابط | الروابط غير المسموحة لا تفتح | `notifications`, `/notifications` |
| الإعدادات والمراكز/القاعات | Admin/مدير مركز | مركز وقاعات | تعديل إعدادات، إدارة قاعات وعضويات | النظام يمنع غير المخول | `center-halls`, `/settings`, `/permissions` |
| الجاهزية والنسخ | Admin | بيانات تشغيلية | فتح readiness، فحص backup، status | مؤشرات واضحة بلا أسرار | `readiness-config`, `/readiness`, `/backup` |
| UX والملاحة الشاملة | الأدوار الرئيسية | مراجع متنوع البيانات | فحص AppShell والصفحات الجامعة وملف المراجع والتبويبات والروابط العميقة على desktop/mobile RTL | لا overflow أو 500، التبويبات حسب الصلاحية، الرجوع والتحديث يعملان | `app-shell-navigation`, `patient-tabs-navigation`, `docs/UX_ROUTE_INVENTORY.md` |
| جرد routes | آلي | لا يحتاج بيانات | مقارنة كل `page.tsx` و`route.ts` مع الجرد و`SYSTEM_MAP.md` | 92 صفحة و18 API، غير المفحوص صفر | `route-inventory.test.ts`, `docs/UX_ROUTE_INVENTORY.md` |
