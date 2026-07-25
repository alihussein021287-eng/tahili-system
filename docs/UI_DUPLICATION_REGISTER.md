# UI Duplication Register

لا يعني وجود نفس المعلومة في مكانين أن أحدهما خطأ. هذا السجل يفصل التكرار البصري عن العرض المقصود والوظائف المتشابهة وroutes التوافق.

| # | النوع | المواقع | السبب والمرجع المعتمد | المعالجة المستقبلية | الخطر | الاختبارات |
| ---: | --- | --- | --- | --- | --- | --- |
| 1 | تكرار بصري | headers في صفحات التشغيل و`PageHeader.tsx` | انتقال تدريجي لنظام التصميم؛ `PageHeader` هو المرجع | استبدال markup المتكرر دون تغيير actions | منخفض | snapshots بصري desktop/mobile |
| 2 | تكرار بصري | بطاقات KPI في `/`, hubs, `station-kpis`, `analytics` | نفس أنماط الرقم/الوصف لا نفس الاستعلام دائماً | مكون KPI presentation-only بمدخلات صريحة | متوسط | مقارنة القيم والصلاحيات |
| 3 | تكرار بصري | جداول وفلاتر المرضى والإحالات والمالية | أنماط table/query متوازية | primitives للجداول والفلاتر دون توحيد queries | متوسط | query params، pagination، empty |
| 4 | تكرار بصري | Combobox والنماذج في settings/staff/patients | حقول متشابهة بمصادر مختلفة | wrappers مشتركة مع إبقاء name/value contract | متوسط | submit payload وrequired |
| 5 | تكرار بصري | empty states عبر معظم الصفحات | نصوص محلية متفرقة | EmptyState مشترك مع نص وظيفي محلي | منخفض | empty/non-empty لكل route |
| 6 | تكرار بصري | ألوان status في referrals/pharmacy/finance/tasks | palettes مستقلة | semantic status tokens دون دمج state names | عال | كل enum/status وdark contrast |
| 7 | تكرار بصري | print buttons وصفحات المستندات | طباعة متخصصة بقوالب متعددة | مكون أمر طباعة فقط؛ تبقى القوالب منفصلة | متوسط | PDF/print RTL وعدم theme |
| 8 | عرض مقصود لدورين | `/my-work`, hubs والصفحة الأصلية | نفس السجل يظهر كقائمة يومية وتفصيل تشغيلي | الإبقاء، وتوحيد الرابط/label فقط | عال | role matrix وdeep link |
| 9 | عرض مقصود لدورين | patient journey وcare board | منظور مراجع مقابل منظور محطة | الإبقاء؛ مشاركة status presenter فقط | عال | مشتقات journey وعدم إنشاء حالة |
| 10 | عرض مقصود لدورين | notifications badges و`/notifications` | badge مختصر ومركز كامل | توحيد counts/link resolver | متوسط | unread/read وصلاحية الرابط |
| 11 | عرض مقصود لدورين | pharmacy patient history وpatient tabs | الصيدلي مقابل الملف السريري | الإبقاء مع مكون قراءة مشترك | عال | إخفاء الأسعار والأهلية |
| 12 | اسم مشابه/وظيفة مختلفة | patient attendance وstaff attendance | حضور مراجع مقابل دوام موظف | تمييز النص والicon؛ لا دمج | عال | visit vs attendance tables/actions |
| 13 | اسم مشابه/وظيفة مختلفة | therapy sessions وcenter sessions | خطة علاج عامة مقابل برنامج مركز | توثيق المصطلح وإبقاء models/actions | عال | membership، plan، result |
| 14 | اسم مشابه/وظيفة مختلفة | inventory وpharmacy stock/batches | catalog قديم مقابل مخزون ودفعات | navigation نحو hub مع إبقاء route | عال | quantities، batches، permissions |
| 15 | اسم مشابه/وظيفة مختلفة | approvals وexpense approvals | موافقات عامة مقابل مستويات صرفية | فصل labels والتقارير | عال | approval levels وaudit |
| 16 | route توافق | `/attendance` → `/staff?tab=attendance` | deep links قديمة؛ hub هو المرجع | إبقاء redirect والمعلمات | منخفض | redirect/query preservation |
| 17 | route توافق | `/shifts` → `/staff?tab=shifts|leaves` | deep links قديمة؛ hub هو المرجع | إبقاء redirect والمعلمات | منخفض | shifts/leaves query |
| 18 | route توافق | `/tasks` → `/staff?tab=tasks` | deep links وتنبيهات قديمة | إبقاء redirect والفلاتر | منخفض | assignee/status filters |

## Totals

- تكرار بصري قابل للتوحيد: **7**.
- عرض مقصود حسب السياق أو الدور: **4**.
- وظائف مختلفة باسم متشابه: **4**.
- routes توافق يجب أن تبقى: **3**.
- الإجمالي المسجل: **18**.
