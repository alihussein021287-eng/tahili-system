# طلب منفصل: جلسات أجهزة Tahili Mobile

## الحالة

- القرار المطلوب: **موافقة صريحة قبل التنفيذ**
- الشدة التي يعالجها: `SEC-MOB-001 — High`
- التغيير المنفذ حالياً: **لا شيء**
- Prisma schema أو migration منشأة: **لا**
- أثر الإنتاج: **لا يوجد؛ التنفيذ المقترح يبدأ على VM التطوير فقط**

## المشكلة

مصادقة الويب الحالية مبنية على NextAuth/JWT و`User.authVersion`.
`authVersion` يستطيع إبطال جلسات المستخدم كلها، لكنه لا يوفر:

- تسجيل installation موبايل مستقلة؛
- إلغاء جهاز واحد مفقود أو مسروق؛
- refresh-token rotation أحادي الاستخدام؛
- كشف إعادة استخدام refresh token بعد السرقة؛
- انتهاء مطلق ودائم لجلسة الجهاز؛
- سجلاً خادمياً موثوقاً لحالة كل جلسة.

لا يجوز إعادة استخدام `Device` لأنه جهاز طبي للمراجع، ولا
`DisplayDevice` لأنه شاشة طابور. البدائل in-memory أو JSON غير مقبولة لأنها
تفقد حالة الإلغاء عند restart أو عند تعدد instances.

## نطاق الموافقة المقترح

الموافقة على تصميم وتنفيذ migration تطويرية تضيف ثلاثة models مستقلة بأسماء
نهائية تراجع عند التنفيذ:

### `MobileDevice`

يمثل installation واحدة، ولا يعتمد على hardware identifiers.

| الحقل المنطقي | الغرض |
| --- | --- |
| `id` | معرف داخلي عشوائي |
| `userId` | مالك التسجيل الحالي |
| `installationHash` | hash لمعرف عشوائي منشأ داخل التطبيق |
| `platform` | `ANDROID` أو `IOS` فقط |
| `appVersion` | نسخة التطبيق لأغراض الحد الأدنى المدعوم |
| `registeredAt` | وقت التسجيل |
| `lastSeenAt` | وقت آخر اتصال ناجح، بدقة مخفضة |
| `revokedAt` | إلغاء الجهاز |
| `revokedReasonCode` | code ثابت من allowlist، بلا نص حر |
| `createdAt`, `updatedAt` | lifecycle |

القيود المطلوبة:

- uniqueness مناسب لـ`userId + installationHash`؛
- indexes على `userId`, `revokedAt`, ووقت النشاط؛
- لا اسم مستخدم، patient identifier، IP خام، token، أو device serial؛
- label اختياري يكتبه المستخدم ممنوع في الدفعة الأولى لتقليل البيانات.

### `MobileSession`

يمثل token family واحدة مرتبطة بجهاز.

| الحقل المنطقي | الغرض |
| --- | --- |
| `id` | معرف جلسة داخلي |
| `deviceId` | الجهاز المسجل |
| `accessCredentialHash` | hash للـaccess credential إن كان opaque |
| `familyId` | معرف عشوائي لعائلة الدوران |
| `currentGeneration` | آخر رقم rotation مقبول |
| `authVersion` | نسخة هوية المستخدم عند الإصدار |
| `accessExpiresAt` | انتهاء access القصير |
| `absoluteExpiresAt` | انتهاء refresh family المطلق |
| `rotatedAt` | آخر rotation ناجح |
| `revokedAt` | إلغاء الجلسة |
| `revokedReasonCode` | سبب ثابت من allowlist |
| `createdAt`, `updatedAt` | lifecycle |

### `MobileRefreshCredential`

صف دائم لكل generation حتى انتهاء family، كي يمكن تمييز replay حقيقي بعد
rotation أو restart من token عشوائي غير صالح.

| الحقل المنطقي | الغرض |
| --- | --- |
| `id` | معرف داخلي عشوائي |
| `sessionId` | token family المالكة |
| `credentialHash` | hash فريد للـcredential العشوائي |
| `generation` | رقم generation داخل family |
| `state` | `ACTIVE`, `CONSUMED`, أو `REVOKED` |
| `expiresAt` | نهاية الاحتفاظ المطلوبة لكشف replay |
| `consumedAt` | وقت الدوران الناجح |
| `createdAt` | lifecycle |

القيود المطلوبة:

- hashes فقط؛ لا raw access/refresh credentials؛
- unique indexes على `credentialHash` و`sessionId + generation`؛
- تبقى hashes المستهلكة حتى `absoluteExpiresAt` مع bounded cleanup لاحق؛
- lookup يبدأ من hash credential كاملة عالية entropy. token عشوائي لا يطابق
  صفاً لا يلغي family، كي لا يصبح التخمين وسيلة DoS؛
- rotation يستخدم transaction وcompare-and-set على `ACTIVE`. طلب متزامن
  واحد فقط يحوله إلى `CONSUMED` وينشئ generation التالية؛
- مطابقة hash لصف `CONSUMED` تعني replay وتلغي family كاملة؛
- انقطاع response بعد rotation قد يفرض login جديداً، ولا يعاد raw token أو
  يخزن قابلاً للاسترجاع لتجاوز ذلك؛
- cascade/delete policy لا تمحو audit المطلوب بصمت.

لا تعد هذه الجداول cache طبية، ولا تخزن أي بيانات مراجع.

## سلوك المصادقة المقترح

1. login online يعيد استخدام تحقق كلمة سر Tahili بعد فصله إلى helper
   server-only واختبار parity مع الويب.
2. التطبيق ينشئ installation secret عشوائياً ولا يقرأ IMEI/serial/advertising
   ID.
3. الخادم يصدر access credential لمدة 5–10 دقائق وrefresh credential عشوائياً
   256-bit.
4. access يبقى في ذاكرة التطبيق فقط؛ refresh في SecureStore فقط.
5. refresh يدور مرة واحدة داخل transaction؛ إعادة credential قديم تلغي
   family وتعيد `SESSION_REVOKED`.
6. كل request يتحقق من session والجهاز والمستخدم و`authVersion` والصلاحيات
   والنطاق.
7. logout يمسح الجهاز محلياً فوراً وبلا شرط شبكة. إذا كان online يحاول
   إلغاء الجلسة خادمياً أولاً؛ فشل الطلب لا يؤخر الـwipe ولا يدعي نجاح revoke.
8. disable user أو تغيير `authVersion` يمنع الجلسات عند أول request لاحق.

إذا كان logout offline تبقى الجلسة الخادمية حتى `absoluteExpiresAt` أو إلغاء
إداري؛ لا يخزن التطبيق credential أو outbox كي يحاول revoke لاحقاً.

## الإدارة والإلغاء

الدفعة الأولى تحتاج:

- إلغاء الجلسة الحالية من التطبيق؛
- إلغاء تلقائي عند replay/expiry/account invalidation؛
- عملية خادمية مقيدة لمسؤول يملك `users.manage` لإلغاء جهاز محدد عند الفقدان.

أي شاشة إدارة أجهزة في تطبيق الويب ليست ضمن هذه الموافقة تلقائياً. إذا
احتاج التشغيل شاشة، توثق كتغيير UI/functional منفصل مع audit واختبارات
صلاحية. لا تنشأ permission جديدة ضمن هذا الطلب.

## Audit وrate limiting

- تستخدم أحداثاً ذات codes ثابتة: register, login success/failure aggregate,
  refresh, revoke, replay, expiry.
- يمنع تخزين username، raw IP، patient ID، headers، bodies، أو tokens.
- يستخدم Request ID منقح فقط.
- يجب أن يكون audit الأمني المطلوب durable؛ لا يعتمد على helper يبتلع فشل
  الكتابة عند حدث revoke/replay.
- rate limits لـlogin/refresh/register تكون خادمية وتفشل بأمان. اختيار مخزن
  limiter وتعدد instances يوثق قبل الكود.

## الملفات المتوقع تغييرها بعد الموافقة

- `prisma/schema.prisma`
- migration جديدة واحدة صريحة تحت `prisma/migrations/`
- `src/proxy.ts`
- `src/lib/mobile/auth/**`
- `src/app/api/mobile/v1/auth/**`
- اختبارات unit/integration مخصصة
- قسم models في `SYSTEM_MAP.md`، وأقسام التشغيل ذات الصلة فقط

لن تُعدل models الطبية أو role/permission definitions أو Server Actions
الحالية ضمن هذا الطلب.

## حد الـNext.js proxy

`src/proxy.ts` الحالي يطبق NextAuth على كل route غير عامة؛ opaque bearer لا
يمكن فكها كـNextAuth JWT وقد تتحول الاستجابة إلى redirect نحو `/login`.
بعد الموافقة يلزم branch محدود لـ`/api/mobile/v1/**`:

- يبقي `resolveEnvironmentAccess` وhost validation؛
- يحذف Request ID الوارد ويولد Request ID من proxy؛
- لا يحاول فك opaque bearer ولا يعيد redirect HTML؛
- يمرر الطلب إلى Route Handler؛ login له guard عام محدود، وrefresh له
  refresh guard، وكل route محمية لها mobile bearer guard خادمي؛
- لا تضاف المسارات إلى قائمة public عامة ولا تعتمد على proxy وحده للتفويض.

تثبت الاختبارات أن login يعمل بلا NextAuth cookie، وأن route محمية بلا
bearer تعيد `401` JSON، وأن opaque bearer يصل إلى guard، وأن web routes
الحالية لا تتغير.

## خطة migration والرجوع

1. إضافة الجداول والـindexes فقط، من دون تعديل بيانات موجودة.
2. تطبيق migration على قاعدة التطوير.
3. تشغيل inventory وPrisma validation والاختبارات.
4. لا backfill لبيانات طبية أو جلسات ويب.
5. قبل أي إنتاج مستقبلي، يوثق deploy/rollback منفصل.
6. الرجوع في التطوير يكون migration صريحة ومدروسة بعد التأكد من عدم وجود
   جلسات QA مطلوبة؛ لا `db push` ولا `reset`.

## بوابات القبول

- refresh rotation المتزامن يسمح بطلب واحد فقط.
- exact replay لصف مستهلك يلغي family ولا ينجح بعد restart.
- token عشوائي لا يطابق hash لا يستطيع إلغاء family.
- consumed hashes تبقى حتى انتهاء family وتزال بعملية bounded.
- current-device revoke لا يلغي أجهزة أخرى.
- offline logout يمسح محلياً فوراً حتى عند فشل server revoke.
- `authVersion`/disable/revocation تمنع API وrefresh.
- لا raw credential في DB أو logs أو exception snapshots.
- audit وrate limiting يمران باختبارات failure paths.
- migration لا تغير counts أو records في جداول الأعمال.
- Security Review: 0 Critical / 0 High.

## القرار المطلوب من المالك

الموافقة الصريحة على:

1. إضافة `MobileDevice`, `MobileSession`, و`MobileRefreshCredential` (أو
   أسماء نهائية مكافئة) ومigration تطويرية؛
2. استخدام `users.manage` لعملية إلغاء جهاز إدارية خادمية، بلا شاشة في هذه
   الدفعة؛
3. بناء opaque credential rotation وفق الحدود أعلاه.

بدون هذه الموافقة يبقى auth/API/scaffold الخاص بالموبايل متوقفاً.
