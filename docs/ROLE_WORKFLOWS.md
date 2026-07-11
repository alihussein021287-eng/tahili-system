# Role Workflows - Tahili System

هذه الوثيقة تحدد طريقة تنظيم النظام حسب فئات العمل داخل المجمع التأهيلي.

## 1. الاستقبال / الاستعلامات

الهدف:
- تسجيل مراجع جديد بسرعة.
- البحث عن مراجع موجود.
- إنشاء موعد أو إدخال للطابور.
- طباعة بطاقة أو ملخص زيارة.

الشاشات المهمة:
- patients
- appointments
- queue
- search

الصلاحيات المقترحة:
- patients.view
- patients.create
- appointments.view
- appointments.create
- queue.view
- queue.manage

## 2. الطبيب

الهدف:
- فتح ملف المراجع.
- قراءة التاريخ الطبي.
- كتابة التشخيص والخطة.
- إصدار تقرير أو وصفة.
- اعتماد الإحالات أو القرارات الطبية.

الشاشات المهمة:
- patients
- reports
- approvals
- meds
- care-board

الصلاحيات المقترحة:
- patients.view
- patients.update
- reports.view
- reports.create
- approvals.view
- approvals.manage

## 3. المعالج / العلاج الطبيعي أو التأهيلي

الهدف:
- مشاهدة جلسات اليوم.
- تسجيل الجلسة.
- متابعة التقدم.
- رفع صور أو مرفقات علاجية.
- تسجيل ملاحظات الخطة العلاجية.

الشاشات المهمة:
- patients
- tasks
- care-board
- workload
- station-kpis

الصلاحيات المقترحة:
- patients.view
- patients.update
- tasks.view
- tasks.manage

## 4. الصيدلية

الهدف:
- مشاهدة الوصفات المعلقة.
- صرف الأدوية.
- متابعة المخزون والانتهاء.
- منع الصرف بدون توفر.

الشاشات المهمة:
- pharmacy
- meds
- inventory
- reports

الصلاحيات المقترحة:
- pharmacy.view
- pharmacy.dispense
- inventory.view
- inventory.manage

## 5. المالية / الحسابات

الهدف:
- إصدار فواتير.
- تسجيل دفعات.
- متابعة الصندوق اليومي.
- تقارير الإيرادات والمستحقات.

الشاشات المهمة:
- finance
- reports
- patients

الصلاحيات المقترحة:
- finance.view
- finance.manage
- reports.view
- patients.view

## 6. الإدارة

الهدف:
- مراقبة مؤشرات الأداء.
- متابعة الزخم.
- إدارة المستخدمين والصلاحيات.
- مراجعة سجل التدقيق.
- النسخ الاحتياطي.

الشاشات المهمة:
- analytics
- station-kpis
- workload
- users
- permissions
- audit
- backup
- settings

الصلاحيات المقترحة:
- reports.view
- users.manage
- roles.manage
- audit.view
- settings.backup
- settings.manage

## 7. المريض / ذويه

الهدف:
- عرض معلومات محدودة وآمنة.
- معرفة المواعيد.
- طباعة أو عرض QR.
- متابعة حالة المسار بدون كشف بيانات داخلية.

الشاشات المهمة:
- portal

الصلاحيات المقترحة:
- portal.view

## خطة التطوير اللاحقة

1. إنشاء Dashboard حسب الدور.
2. إظهار الكروت حسب الصلاحيات لا حسب اسم الدور فقط.
3. تقليل ازدحام القائمة الجانبية.
4. إضافة Quick Actions لكل فئة.
5. إضافة تقارير يومية مختصرة لكل فئة.
