# UX Route Inventory

جرد واجهات Tahili بعد تحديث تجربة الاستخدام. المصدر الآلي هو `src/app`، ويغطي كل `page.tsx` و`route.ts` بتاريخ 2026-07-22.

## Summary

| التصنيف | العدد | المعنى |
| --- | ---: | --- |
| `VISUAL` | 73 | صفحة تشغيل فُحصت واستفادت من نظام التصميم أو مكونات الصفحة المشتركة |
| `UNCHANGED` | 4 | شاشة متخصصة خارج AppShell ولا تحتاج توحيد واجهة التشغيل |
| `PRINT` | 13 | صفحة طباعة أو مستند ثابت؛ راجعت للطباعة والاستجابة ولا تعامل كواجهة تشغيل |
| `LEGACY` | 3 | route قديم محفوظ للتوافق ويحوّل إلى الصفحة الجامعة مع query parameters |
| `API` | 18 | Route Handler بلا واجهة مرئية |
| غير مفحوص | 0 | لا توجد صفحة مستخدم فعلية خارج الجرد |

إجمالي صفحات الواجهة `page.tsx`: **93**. إجمالي Route Handlers: **18**. إجمالي routes في الجرد: **111**.

## Pages

| Route | التصنيف | ملاحظة |
| --- | --- | --- |
| `/` | `VISUAL` | الرئيسية داخل AppShell |
| `/account` | `VISUAL` | الحساب وتغيير كلمة المرور |
| `/analytics` | `VISUAL` | تحليلات وفلاتر وتقارير |
| `/appointments` | `VISUAL` | مواعيد ونماذج وجدول |
| `/appointments/[id]/qr` | `PRINT` | بطاقة موعد وQR للطباعة |
| `/appointments/calendar` | `VISUAL` | تقويم أسبوعي متجاوب |
| `/approvals` | `VISUAL` | دورة الموافقات والإجراءات |
| `/attendance` | `LEGACY` | يحوّل إلى `/staff?tab=attendance` ويحفظ المعلمات |
| `/audit` | `VISUAL` | سجل تدقيق مقيد الصلاحية |
| `/backup` | `VISUAL` | النسخ الاحتياطي وحالات التشغيل |
| `/beds` | `VISUAL` | الرقود والأسرة، مرتبط بجامعة العلاج |
| `/care-board` | `VISUAL` | لوحة مسار الرعاية |
| `/centers` | `VISUAL` | مساحات المراكز |
| `/centers/[slug]` | `VISUAL` | مساحة مركز ديناميكية |
| `/centers/[slug]/programs/[id]` | `VISUAL` | تفاصيل برنامج مركز |
| `/centers/[slug]/resources` | `VISUAL` | موارد وقاعات المركز |
| `/centers/[slug]/today` | `VISUAL` | جلسات المركز اليومية |
| `/centers/reports` | `VISUAL` | تقارير المراكز |
| `/collaboration` | `VISUAL` | دردشات التعاون |
| `/collaboration/admin` | `VISUAL` | إدارة التعاون |
| `/collaboration/files` | `VISUAL` | ملفات التعاون ومشاركة الملفات |
| `/devices` | `VISUAL` | الأجهزة والصيانة |
| `/display` | `UNCHANGED` | شاشة عرض طابور/اقتران مستقلة عن AppShell |
| `/finance` | `VISUAL` | المالية والفواتير |
| `/finance/[id]/receipt` | `PRINT` | وصل مالي للطباعة |
| `/finance/expenses` | `VISUAL` | صرفيات الجرحى |
| `/finance/expenses/[id]` | `VISUAL` | تفاصيل الصرفية وإجراءاتها |
| `/finance/expenses/[id]/voucher` | `PRINT` | سند صرف للطباعة |
| `/finance/expenses/reports` | `VISUAL` | تقارير الصرفيات |
| `/finance/payments` | `VISUAL` | الدفعات المالية |
| `/finance/report` | `VISUAL` | تقرير مالي تفاعلي |
| `/inventory` | `VISUAL` | مخزون قديم مرتبط بجامعة الصيدلية |
| `/login` | `UNCHANGED` | شاشة مصادقة مستقلة ومصممة لغرضها |
| `/login-log` | `VISUAL` | سجل الدخول |
| `/maintenance` | `VISUAL` | الصيانة وإجراءات النظام |
| `/meds` | `VISUAL` | أدوية الراقدين |
| `/my-work` | `VISUAL` | قائمة عمل مشتقة من الوحدات الحالية حسب الصلاحية |
| `/notifications` | `VISUAL` | مركز التنبيهات والفلاتر |
| `/official-docs` | `VISUAL` | الأرشيف الرسمي |
| `/official-docs/[id]` | `VISUAL` | عرض وتعديل وطباعة وثيقة رسمية |
| `/patients` | `VISUAL` | قائمة المراجعين |
| `/patients-care` | `VISUAL` | الصفحة الجامعة للرعاية |
| `/patients/[id]` | `VISUAL` | ملف المراجع وكل تبويباته |
| `/patients/[id]/admission/[admissionId]` | `PRINT` | قرار رقود للطباعة |
| `/patients/[id]/card` | `PRINT` | بطاقة المراجع وQR |
| `/patients/[id]/care-print` | `PRINT` | سجل التداوي والتضميد |
| `/patients/[id]/edit` | `VISUAL` | تعديل بيانات المراجع |
| `/patients/[id]/journey-print` | `PRINT` | مسار المتابعة للطباعة |
| `/patients/[id]/medical-report/[reportId]` | `PRINT` | تقرير طبي مفرد |
| `/patients/[id]/report` | `PRINT` | ملخص ملف للطباعة |
| `/patients/[id]/sick-leave/[lid]` | `PRINT` | شهادة إجازة مرضية |
| `/patients/[id]/sick-leave/[lid]/official` | `PRINT` | نموذج إجازة رسمي |
| `/patients/data-quality` | `VISUAL` | جودة بيانات المراجعين |
| `/patients/import` | `VISUAL` | استيراد المراجعين |
| `/patients/new` | `VISUAL` | إنشاء مراجع |
| `/permissions` | `VISUAL` | مصفوفة الصلاحيات |
| `/pharmacy` | `VISUAL` | مساحة صرف الصيدلية |
| `/pharmacy-inventory` | `VISUAL` | الصفحة الجامعة للصيدلية والمخزون |
| `/pharmacy/log` | `VISUAL` | سجل حركات الصيدلية |
| `/pharmacy/patient/[id]` | `VISUAL` | سجل صيدلي للمراجع |
| `/pharmacy/purchases` | `VISUAL` | أوامر الشراء |
| `/pharmacy/purchases/[id]` | `VISUAL` | تفاصيل أمر شراء |
| `/pharmacy/purchases/reports` | `VISUAL` | تقارير الشراء |
| `/pharmacy/reports` | `VISUAL` | تقارير الصيدلية |
| `/pharmacy/rx/[id]` | `PRINT` | وصفة خارجية للطباعة |
| `/pharmacy/stock` | `VISUAL` | الأدوية والمخزون |
| `/portal/[token]` | `UNCHANGED` | بوابة مراجع عامة محدودة البيانات خارج AppShell |
| `/queue` | `VISUAL` | الطابور، مرتبط بجامعة الرعاية |
| `/readiness` | `VISUAL` | جاهزية النظام |
| `/referrals` | `VISUAL` | قائمة الفحوص والإحالات |
| `/referrals/[id]` | `VISUAL` | تفاصيل إحالة ديناميكية |
| `/referrals/[id]/official` | `PRINT` | كتاب إحالة رسمي |
| `/reports` | `VISUAL` | مركز التقارير |
| `/reports-finance` | `VISUAL` | الصفحة الجامعة للتقارير والمالية |
| `/reports/daily` | `VISUAL` | التقرير اليومي وفلاتره |
| `/reports/official` | `VISUAL` | التقارير الرسمية |
| `/reports/statistical` | `VISUAL` | التقرير الإحصائي |
| `/search` | `VISUAL` | البحث الشامل والنتائج |
| `/settings` | `VISUAL` | الإعدادات بتبويبات URL |
| `/setup` | `UNCHANGED` | تهيئة أولية محمية ولا تظهر بعد وجود مدير |
| `/shifts` | `LEGACY` | يحوّل إلى `/staff?tab=shifts|leaves` ويحفظ المعلمات |
| `/staff` | `VISUAL` | الصفحة الجامعة للموظفين والمهام |
| `/station-kpis` | `VISUAL` | مؤشرات محطات الرعاية |
| `/tasks` | `LEGACY` | يحوّل إلى `/staff?tab=tasks` ويحفظ الفلاتر |
| `/therapy` | `VISUAL` | لوحة رئيس المعالجين مرتبطة بجامعة العلاج |
| `/therapy-centers` | `VISUAL` | الصفحة الجامعة للعلاج والمراكز |
| `/therapy/plans/[id]/final` | `VISUAL` | التقييم النهائي للخطة |
| `/therapy/today` | `VISUAL` | جلسات المعالج اليومية |
| `/users` | `VISUAL` | إدارة المستخدمين |
| `/users/[id]` | `VISUAL` | تفاصيل مستخدم وصلاحياته |
| `/visits` | `VISUAL` | الحضور والزيارات |
| `/workload` | `VISUAL` | حمل المعالجين |
| `/workspaces` | `VISUAL` | مساحات العمل حسب الصلاحيات |

## Route Handlers

| Route | التصنيف | المالك الوظيفي |
| --- | --- | --- |
| `/api/auth/[...nextauth]` | `API` | المصادقة |
| `/api/backup-download` | `API` | النسخ الاحتياطي |
| `/api/collaboration/conversations/[id]/messages` | `API` | رسائل التعاون |
| `/api/collaboration/files` | `API` | رفع ملفات التعاون |
| `/api/collaboration/files/[id]/download` | `API` | تنزيل ملف تعاون |
| `/api/collaboration/files/[id]/preview` | `API` | معاينة ملف تعاون |
| `/api/display/feed` | `API` | تغذية شاشة الطابور |
| `/api/export/data-quality` | `API` | تصدير جودة البيانات |
| `/api/export/full` | `API` | التصدير الكامل |
| `/api/export/patients` | `API` | تصدير المراجعين |
| `/api/export/patients-template` | `API` | قالب استيراد المراجعين |
| `/api/export/wounded-expenses` | `API` | تصدير الصرفيات |
| `/api/files/[...key]` | `API` | الملفات المحمية |
| `/api/permissions/export` | `API` | تصدير الصلاحيات |
| `/api/presence/ping` | `API` | حالة الاتصال |
| `/api/queue/today` | `API` | بيانات طابور اليوم |
| `/api/readiness/report` | `API` | تقرير الجاهزية |
| `/api/reminders/due` | `API` | التذكيرات المستحقة |

## Cross-check

- `AppShell.tsx` يربط الصفحات الجامعة ويعامل المسارات القديمة كحالات نشطة ضمن مجموعاتها.
- `attendance`, `shifts`, و`tasks` هي تحويلات توافق صريحة تحفظ query parameters.
- كل صفحة ديناميكية `[id]`, `[slug]`, `[token]` مصنفة أعلاه.
- حالات `loading.tsx`, `error.tsx`, و`not-found.tsx` موجودة ومطوّرة ضمن النظام المشترك.
- لا توجد migration أو تغييرات Prisma ضمن تحديث التصميم.
