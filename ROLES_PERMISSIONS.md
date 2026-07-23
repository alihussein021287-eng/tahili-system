# Roles and Permissions

هذا مرجع تشغيلي مختصر. المصدر الفعلي هو `src/lib/perms.ts` مع تعديلات قاعدة البيانات عبر `RolePermission` و`UserPermission`. حدّث هذا الملف عند تغيير صلاحيات أو قواعد ظهور الصفحات.

## الأدوار وما يظهر تقريباً

| الدور | يظهر له عادة | صفحات متوقعة |
| --- | --- | --- |
| `ADMIN` | كل النظام، كل المجموعات، الحذف والصلاحيات الحساسة | `/`, `/patients-care`, `/therapy-centers`, `/pharmacy-inventory`, `/reports-finance`, `/staff`, `/settings`, `/users`, `/permissions`, `/readiness` |
| `MANAGER` | الرعاية، العلاج، الصيدلية، التقارير، الموظفون بدون إدارة مستخدمين كاملة | `/patients-care`, `/therapy-centers`, `/pharmacy-inventory`, `/reports-finance`, `/staff` |
| `DOCTOR`, `RESIDENT` | ملفات المراجعين، التشخيص، الإحالات، التقارير الطبية، خطط العلاج حسب الصلاحية | `/patients-care`, `/therapy-centers`, `/reports-finance` |
| `HEAD_THERAPIST` | إدارة الخطط والجلسات والمراكز ضمن العضوية، ومتابعة الفريق | `/therapy-centers`, `/patients-care`, `/staff?tab=tasks` |
| `THERAPIST` | جلسات اليوم، الخطط المسندة، المهام، مراكز العضوية | `/therapy-centers`, `/staff?tab=tasks` |
| `RECEPTION`, `DATA_ENTRY` | تسجيل المراجعين، الزيارات، الطابور، المواعيد، بعض الإحالات | `/patients-care` |
| `PHARMACIST` | صرف الوصفات، الأدوية، المخزون، الدفعات، أوامر الشراء حسب الصلاحية | `/pharmacy-inventory` |
| `ACCOUNTANT` | المالية، الفواتير، الدفعات، الصرفيات والتقارير المسموحة | `/reports-finance`, `/patients-care?tab=patients` |
| `LAB`, `RADIOLOGY`, `DRESSING`, `PROSTHETICS` | محطة العمل المرتبطة بالمراجع، التقارير أو الأجهزة/التضميد حسب الدور | `/patients-care` وروابط محددة حسب الصلاحية |
| `VIEWER` | قراءة محدودة للرئيسية، المراجعين، التقارير، المهام والتعاون | `/`, `/patients-care`, `/reports-finance` |

## ترتيب المساحة اليومية

هذا ترتيب عرض فقط ولا يضيف صلاحيات. تظهر `/my-work` لكل مستخدم يملك `dashboard.view`، ثم لا يُستعلم عن أي مصدر ولا يظهر أي عنصر أو رابط إلا إذا كانت صلاحيته الفعلية موجودة.

| الدور | الأولوية اليومية |
| --- | --- |
| `RECEPTION`, `DATA_ENTRY` | مواعيد وحضور اليوم، غير الداخلين للطابور، الطابور، والزيارات |
| `RESIDENT` | محطة المقيم، التشخيصات والمتابعات، والحالات المستعدة للمرحلة التالية |
| `DOCTOR` | الإحالات المنتظرة، التشخيص والتقارير، والمتابعة |
| `HEAD_THERAPIST` | الخطط غير المسندة، نقص القاعة، الجلسات، وحمل المعالجين ضمن العضوية |
| `THERAPIST` | جلسات اليوم والنتائج غير المسجلة ضمن العضوية |
| `PHARMACIST` | الوصفات، المخزون المنخفض، الدفعات القريبة، والشراء والاستلام |
| `ACCOUNTANT` | الصرفيات بمستوى الإجراء الفعلي، بلا مبالغ دون `expenses.amounts` |
| `ADMIN`, `MANAGER` | الجاهزية، الحسابات، التنبيهات والتدقيق حسب الصلاحية |
| `LAB`, `RADIOLOGY`, `DRESSING`, `PROSTHETICS` | محطة المركز الحالية وحالات الانتظار |

`src/lib/work-registry.ts` هو مصدر العرض المركزي للroute والـhub/tab والصلاحيات المطلوبة. يبقى `src/lib/perms.ts` مع `RolePermission` و`UserPermission` وعضوية المركز المصدر النهائي للقرار.

## صلاحيات حساسة

- النظام: `settings.view`, `settings.edit`, `settings.backup`, `users.manage`, `users.permissions`, `audit.view`.
- المالية: `finance.view`, `finance.invoice`, `finance.payment`, `finance.report`.
- صرفيات الجرحى: `expenses.amounts`, `expenses.approve`, `expenses.pay`, `expenses.correct`.
- الصيدلية: `pharmacy.purchase.prices`, `pharmacy.purchase.approve`, `pharmacy.purchase.override`.
- التعاون: `files.admin`, `files.delete.permanent`, `files.audit`, `chat.moderate`.
- الجاهزية والنسخ: `/readiness` و`/backup` يجب أن تبقى خلف صلاحيات النظام.

## قواعد عملية

افحص الصلاحية في Server Actions أو server components، وليس في الواجهة فقط. إذا أضفت route جديداً، اربطه بصلاحية واضحة، واختبر أن الأدوار غير المخولة لا ترى الرابط ولا تفتح الصفحة مباشرة.
