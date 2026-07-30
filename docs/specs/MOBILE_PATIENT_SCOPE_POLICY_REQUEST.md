# طلب منفصل: سياسة نطاق مراجعي Tahili Mobile

## الحالة

- القرار المطلوب: **اعتماد تشغيلي وأمني قبل التنفيذ**
- الشدة التي يعالجها: `SEC-MOB-002 — High`
- التغيير المنفذ حالياً: **لا شيء**
- تغيير role/permission/workflow منفذ: **لا**

## المشكلة

لا توجد حالياً predicate واحدة تعني «المراجع الذي يجوز لهذا المستخدم
استلام بياناته على الهاتف». سلوك الويب موزع بين:

- `patients.view` لفتح قوائم وتفاصيل؛
- branch filter افتراضي يمكن أن يصبح `all`؛
- `CenterMembership` لبعض بيانات المراكز؛
- إسنادات العلاج، queue، appointments، و`my-work` كلٌ حسب سياقه؛
- سياسة tabs تحدد ظهور التبويب، لكنها ليست patient-row authorization.

نسخ سلوك الويب حرفياً إلى cache offline قد يرسل بيانات أوسع من الحد الأدنى
اللازم. وفي المقابل، اختراع قاعدة أضيق قد يمنع موظفاً من عمله أو يغير
workflow ضمنياً. لذلك يلزم قرار مالك النظام قبل الكود.

## القرار المعماري الثابت

مهما كان الخيار التشغيلي:

- الخادم يبني النطاق قبل query؛
- direct patient IDs تمر predicate نفسها؛
- فشل حل branch/center/assignment المطلوبة للدور يعني no rows، لا fallback
  واسع؛ البعد `not_applicable` لا يقبل إلا إذا نص عليه matrix الدور؛
- tab visibility لا تمنح patient access؛
- cache لا توسع النطاق الذي أعاده الخادم؛
- تغير role/permission/branch/center/assignment يغير `scopeFingerprint`
  ويلغي snapshot المحلية؛
- لا يعتمد القرار على إخفاء شاشة الموبايل.

## الخيار الموصى به: نطاق Mobile الأدنى

Mobile read access يكون تقاطع:

```text
active user
AND effective permission
AND role-specific operational scope
AND branch/center constraints
AND requested resource/tab policy
```

ويُعتمد matrix صريح لكل دور، لا rule ضمنية. المسودة التالية تحتاج تصديق
المالك وليست سلوكاً معتمداً:

| فئة الدور | مسودة نطاق المراجع للموبايل |
| --- | --- |
| `ADMIN`, `MANAGER` | لا cache شاملة افتراضياً؛ مراجعين مرتبطين بعمل اليوم أو بحث online صريح، مع حد وعدّ audit |
| `DOCTOR` | مواعيد/إحالات/حالات موكلة أو مفتوحة للطبيب وفق تعريف تشغيلي معتمد |
| `RECEPTION`, `DATA_ENTRY` | مراجعين مرتبطين بالفرع الحالي ومواعيد/طابور/مهام اليوم |
| `HEAD_THERAPIST`, `THERAPIST` | مراجعين لديهم إسناد/خطة/جلسة فعالة ضمن المراكز المتاحة للمستخدم |
| `PHARMACIST` والأدوار المحطية | مراجعين ظاهرين في work item مشروع للدور؛ لا قائمة مرضى عامة offline |
| `ACCOUNTANT` وما شابهه | لا بيانات سريرية offline؛ work-item metadata الأدنى فقط إن اعتمد |
| أدوار بلا `patients.view` | لا patient DTOs |

الـmatrix أعلاه لا يغير صلاحيات الويب. إنه قيد إضافي على ما يُخزن offline.

## بديل غير موصى به: Web parity

اعتبار `patients.view` كافياً لإرسال أي مراجع متاح في تجربة الويب، مع
فلترة العلاقات حسب المركز. هذا أبسط تقنياً لكنه:

- يوسع حجم cache؛
- لا يحقق بوضوح «أقل قدر حسب الدور والإسناد»؛
- يزيد أثر فقدان الجهاز؛
- يبقي معنى branch `all` غير مناسب للـoffline.

لا يُنفذ هذا البديل إلا بموافقة صريحة تقبل المخاطر وتحدد سقف snapshot ومدة
الصلاحية.

## أسئلة تشغيلية تحتاج جواباً

1. ما تعريف الإسناد لكل دور: appointment، queue item، referral، treatment
   plan، center membership، أم اتحاد محدد بينها؟
2. هل `ADMIN` و`MANAGER` يحتاجان patient cache أصلاً، أم online search فقط؟
3. هل الفرع الحالي إلزامي للموبايل، وماذا يحدث لمستخدم بلا branch؟
4. هل يستطيع الطبيب الوصول لمراجع غير موكل إليه عبر search online؟
5. ما مدة بقاء المراجع في النطاق بعد انتهاء work item؟
6. ما الحقول الدنيا لكل role؟ خصوصاً الأدوار المالية/الصيدلية.
7. هل التنبيهات التي تشير إلى مراجع تمنح وصولاً مؤقتاً أم تظهر منقحة فقط؟

## عقد التنفيذ بعد الاعتماد

تضاف سياسة server-only مركزية، بأسماء نهائية تراجع مع الكود:

```ts
type BranchScope =
  | { state: "resolved"; branchId: number }
  | { state: "not_applicable" }
  | { state: "failed" };

type CenterScope =
  | { state: "resolved"; centerIds: readonly number[] }
  | { state: "not_applicable" }
  | { state: "failed" };

type MobileActorContext = {
  userId: string;
  role: UserRole;
  permissions: ReadonlySet<string>;
  branch: BranchScope;
  centers: CenterScope;
  deviceSessionId: string;
  scopeFingerprint: string;
};

function mobilePatientWhere(
  actor: MobileActorContext,
  purpose: MobilePatientPurpose,
): Prisma.PatientWhereInput;
```

ضوابطها:

- لا تُصدر إلى package العقود أو تطبيق الموبايل؛
- لا تقبل role/center/branch من request body؛
- تبدأ من deny وتضيف الحالات المعتمدة فقط؛
- أي `failed` يفشل مغلقاً. `not_applicable` مسموح فقط للدور الذي اعتمد
  matrix عدم حاجته لذلك البعد؛ و`resolved` بقائمة مراكز فارغة لا يعني all؛
- تستخدم داخل `where: { id, AND: mobilePatientWhere(...) }` للـdirect ID؛
- كل read model له Zod output schema وminimal `select`؛
- المرفقات والحقول عالية الحساسية مستبعدة من Phase 1.

## ما لا يشمله الطلب

- لا تغيير workflow أو transitions؛
- لا permission keys أو role defaults جديدة؛
- لا توسيع وصول أي دور في الويب؛
- لا offline writes؛
- لا نسخ PostgreSQL أو tables كاملة؛
- لا قرار عن ملفات طبية أو تقارير نهائية؛ تبقى خارج Phase 1.

إذا كشف الـmatrix حاجة حقيقية إلى permission أو relation أو assignment غير
موجود، يتوقف التنفيذ ويصدر طلب منفصل جديد؛ لا تُعدّل schema ضمن هذا الطلب.

## اختبارات القبول

- جدول cases لكل role مع allow/deny وbranch/center/assignment combinations.
- direct-ID غير المصرح يعيد استجابة لا تكشف وجود المراجع.
- مستخدم غير مخول لا يستلم row ثم تُحذف محلياً؛ لا يستلمها أصلاً.
- dimension مطلوبة بحالة `failed`، قائمة مراكز مطلوبة فارغة، أو
  permission-store failure تفشل مغلقة؛ center-only role لا يمنع لمجرد أن
  branch معتمد له كـ`not_applicable`.
- تعديل role/permission/membership/assignment يغير scope fingerprint ويمنع
  snapshot القديمة.
- counts قبل/بعد متطابقة، ولا business writes في request handlers.
- اختبارات patient tab policy لا تُستخدم بديلاً عن row-scope tests.
- Security Review: 0 Critical / 0 High.

## القرار المطلوب من المالك

المطلوب اعتماد أحد المسارين:

1. **النطاق الأدنى الموصى به**، ثم تعبئة الأجوبة التشغيلية والـmatrix النهائي؛
2. **Web parity** مع قبول مخاطر cache الواسعة وحدود صريحة.

التوصية هي المسار الأول. لا يبدأ Mobile patient API قبل اعتماد الـmatrix.
