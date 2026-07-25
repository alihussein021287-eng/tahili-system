# Future UI Roadmap

كل دفعة presentation-only. لا تتوسع الدفعة إلى Prisma أو permissions أو Server Actions أو state machines. اقرأ `MEDICAL_WORKFLOW_BOUNDARIES.md` و`UI_INFORMATION_ARCHITECTURE.md` قبل التنفيذ.

| الدفعة | النطاق | الهدف | خارج النطاق | بوابة القبول |
| ---: | --- | --- | --- | --- |
| 1 | primitives: PageHeader, EmptyState, table/filter shell, status tokens | إزالة التكرار البصري منخفض المخاطر | queries، payloads، state labels | unit للprops + desktop/mobile/dark |
| 2 | AppShell، المجموعات، hubs والـdeep links | تقليل ازدحام navigation مع بقاء كل وظيفة | permissions وroute deletion | role matrix + direct URLs + legacy redirects |
| 3 | المرضى والرعاية | تنظيم forms/tables/empty states في hub والصفحات الأصلية | الحقول الطبية والزيارة والطابور والإحالة | reception/resident/doctor E2E |
| 4 | العلاج والمراكز | تحسين plans/sessions/today/halls responsive | plan rules، membership، session results | head therapist/therapist + center isolation |
| 5 | الصيدلية والمالية | وضوح الجداول والحالات والموافقات | FEFO، المخزون، الأسعار، المبالغ والمستويات | pharmacist/accountant/manager + audit |

## Batch Template

1. حدد routes والroles والpermissions والActions قبل التعديل.
2. احفظ baseline للسلوك ولقطات desktop/mobile دون بيانات حساسة.
3. أعد استخدام Design System ولا تنشئ abstraction تغير العقد.
4. حافظ على كل route وtab وquery parameter وCTA.
5. اختبر role matrix وnegative direct URL والحالة الفارغة والممتلئة.
6. شغّل `node scripts/audit-project.mjs` وتأكد أن غير المصنف صفر.
7. أوقف الدفعة عند الحاجة لتغيير workflow، وافتح spec وظيفياً منفصلاً.
