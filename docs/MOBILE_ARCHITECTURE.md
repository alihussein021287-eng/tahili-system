# Tahili Mobile Architecture

## الحالة

- المرحلة: **Phase 0 — inventory and design**
- التاريخ: 2026-07-30
- الفرع: `feature/mobile-offline`
- قرار التنفيذ: **متوقف قبل dependencies وscaffold**
- بوابة الأمن: **FAIL — 0 Critical / 2 High مفتوحة**
- أثر النظام الحالي: لا تغيير في التطبيق أو Prisma أو البيانات أو الخدمات

هذا المستند تصميم تنفيذي، وليس تصريحاً لتغيير schema أو الصلاحيات أو
الإنتاج. يبقى `tahili-system` المصدر الرسمي الوحيد للبيانات، وتبقى قاعدة
الهاتف cache مشفرة ومحدودة الصلاحية.

## نتيجة الجرد

### المصدر الحالي للهوية والصلاحية

- جلسة الويب NextAuth/JWT وتتحقق خادمياً من المستخدم و`authVersion` في
  `src/lib/auth.ts`, `src/lib/access.ts`, و`src/lib/session-validation.ts`.
- الصلاحيات الفعلية هي افتراض الدور ثم `RolePermission` ثم
  `UserPermission` عبر `src/lib/perms.ts` و`src/lib/permission-store.ts`.
- نطاق المركز يعتمد على `CenterMembership` و`accessibleCenterIds()` أو حراس
  المركز المتخصصين.
- `my-work` وpatient journey هما View Models مشتقة، ولا ينشئان حالة أو مهمة.
- سياسة تبويبات المراجع موجودة في `src/lib/patient-tab-policy.ts`، والتحميل
  الكسول المحروس لبعض التبويبات في `src/lib/patient-tab-loader.ts`.

### فجوات تمنع التنفيذ الآمن

1. لا يوجد model دائم لجهاز موبايل أو refresh-token family. الحقل
   `User.authVersion` يبطل جلسات المستخدم كلها ولا يحقق إلغاء جهاز واحد أو
   refresh rotation/replay detection. `Device` جهاز طبي للمراجع، و
   `DisplayDevice` شاشة طابور؛ يحظر إعادة استخدامهما.
2. لا توجد دالة خادمية مركزية تحدد المراجعين المسموحين حسب
   branch/center/assignment. `patients.view` واسع، والفرع في قائمة الويب
   filter افتراضي قابل لاختيار `all`، بينما بعض علاقات المراكز فقط تُفلتر
   لاحقاً. Mobile API يجب أن يكون fail-closed قبل الاستعلام.
3. VM التطوير يحتوي Node `20.20.2` وOpenJDK `21.0.11`، لكنه لا يحتوي Android
   SDK أو `sdkmanager` أو Gradle system installation. هذا prerequisite لاحق،
   وليس سبباً لتجاوز بوابة الأمن.
4. وصول LAN الموثق للتطوير HTTP. يسمح به فقط لبيانات وحسابات QA صناعية.
   إنتاج الموبايل يبقى محظوراً حتى HTTPS داخلي موثوق على الجهاز.
5. `src/proxy.ts` يطبق NextAuth حالياً على كل مسار غير عام. opaque bearer
   يحتاج branch محدوداً للـMobile API يحافظ على host/Request-ID controls
   ويفوض auth إلى Route Handler بلا redirect.
6. لا توجد في الجرد علامة موثوقة تثبت أن حساباً أو مراجعاً QA من الاسم.
   live Mobile API يبقى متوقفاً حتى بيئة بيانات صناعية معزولة أو allowlist
   خادمية موثقة مع ضمان أن مصدر البيانات كله QA.

طلبات القرار المنفصلة:

- `docs/specs/MOBILE_DEVICE_SESSION_SCHEMA_REQUEST.md`
- `docs/specs/MOBILE_PATIENT_SCOPE_POLICY_REQUEST.md`

مواصفة التنفيذ الجامعة:

- `docs/specs/MOBILE_LOCAL_FIRST_MVP.md`

## القرارات المعمارية

### بنية المستودع

بعد اجتياز الطلبين المنفصلين تكون البنية المقترحة:

```text
apps/mobile/
  app/ or src/             React Native screens and navigation
  src/api/                 contract-driven HTTP client
  src/auth/                memory access token + SecureStore refresh token
  src/db/                  SQLCipher open/migrate/wipe
  src/sync/                authorized snapshot staging and atomic swap
  src/features/            home, my-work, patients, journey, tabs, notifications
  android/                 generated locally by Expo prebuild; no secrets

packages/mobile-contracts/
  src/                     Zod schemas, DTOs, enums, API envelope only

src/app/api/mobile/v1/
  auth/                    login, refresh, logout
  bootstrap/               role, effective permissions, scope fingerprint
  snapshot/                bounded authoritative read snapshot
  patients/                optional online search/detail endpoints

src/lib/mobile/
  auth/                    server-only device/session validation
  access/                  fail-closed patient and center scope
  read-models/             minimal Prisma projections
  rate-limit/              login, refresh, and sync limits
  audit/                   redacted security/sync events
```

وضع `apps/mobile` متوافق مع المستودع لأنه يعزل toolchain وnative files عن
تطبيق Next.js. لا يُحوّل الجذر إلى workspace قبل مراجعة أثر ذلك على
`package-lock.json`, Docker build، و`npx tsc --noEmit`. يمكن أن يملك تطبيق
الموبايل lockfile مستقلاً، ويستهلك package العقود محلياً بطريقة يثبتها
اختبار Metro وNext.js قبل اعتمادها.

### الإصدارات المبدئية

يُختار خط Expo SDK 56 المستقر مبدئياً لأنه يطابق Node الحالي وReact Native
0.85/React 19.2.3، بينما Expo SDK 57 يتطلب Node 22.13.x. لا تُثبت الحزم قبل
مراجعة الأمن، وبعد الموافقة تُثبت **patch versions دقيقة** في lockfile
باستخدام `npx expo install` ثم يراجع `expo-doctor`.

- Expo SDK: 56 stable line
- React Native: 0.85 line
- React: 19.2.3 line
- Android compile/target SDK: 36
- `expo-sqlite`: النسخة المتوافقة مع SDK 56 مع `useSQLCipher: true`
- `expo-secure-store`: النسخة المتوافقة مع SDK 56

المراجع الرسمية:

- <https://docs.expo.dev/versions/latest/>
- <https://docs.expo.dev/versions/v56.0.0/sdk/sqlite/>
- <https://docs.expo.dev/guides/local-app-overview/>

لا يعد هذا pin نهائياً حتى يوجد lockfile وفحص audit/license ناجح.

### مسار البيانات

```text
PostgreSQL
  -> Prisma server-only query with actor scope
  -> minimal DTO + Zod output validation
  -> /api/mobile/v1 over approved origin
  -> Zod input validation in mobile
  -> SQLCipher staging tables
  -> atomic active-snapshot swap
  -> role-aware RTL screens
```

يحظر:

- Prisma أو DB client في `packages/mobile-contracts` أو `apps/mobile`
- استدعاء Server Actions من الموبايل
- إرجاع Prisma rows مباشرة
- مزامنة جدول PostgreSQL أو snapshot شامل
- تطبيق الصلاحية بعد جلب البيانات

### المصادقة

التصميم المطلوب بعد موافقة schema:

1. Login online يتحقق من حساب Tahili الحالي وقفل المحاولات.
2. الخادم يسجل installation عشوائية لا hardware ID.
3. يصدر access token قصير العمر (5–10 دقائق) وrefresh token عشوائي 256-bit.
4. access token يبقى في الذاكرة؛ refresh token في SecureStore فقط.
5. الخادم يخزن hashes فقط، ويدور refresh token أحادي الاستخدام.
6. كل API يتحقق من session والجهاز والمستخدم و`authVersion` والصلاحيات
   والنطاق.
7. logout online يحاول إلغاء session خادمياً، لكن يمسح الجهاز محلياً فوراً
   حتى عند فشل الطلب أو غياب الشبكة. revoke من الخادم يمسح عند أول اتصال أو
   عند انتهاء lease.
8. refresh replay يلغي token family ويجبر wipe.

لا تُستخدم NextAuth cookie مباشرة للموبايل، ولا ينشأ JWT مخصص دون مراجعة
تشفيرية مستقلة. التفضيل هو credentials عشوائية opaque مخزنة hashes في
قاعدة Tahili.

logout الذي يختاره المستخدم يمسح محلياً بلا شرط. إذا كان الجهاز offline
تبقى session الخادمية حتى انتهائها المطلق أو إلغاء إداري، ولا يدعي التطبيق
نجاح revoke.

### حد `src/proxy.ts`

يبقى host/environment validation وتوليد Request ID المنقح في proxy. يضاف
لاحقاً branch صريح لـ`/api/mobile/v1/**` قبل NextAuth cookie handling:

- لا يفسر opaque bearer كـNextAuth JWT ولا يعيد redirect إلى `/login`؛
- يمرر login إلى public-login guard، وrefresh إلى refresh guard، وبقية
  المسارات إلى common mobile bearer guard داخل Route Handlers؛
- لا يجعل المسارات «public» تفويضياً؛ كل handler يعلن guard واحداً ويثبته
  route inventory test؛
- تبقى web routes وسلوك cookies الحالي بلا تغيير.

### نطاق البيانات

كل endpoint يبني `MobileActorContext` مرة واحدة:

```ts
type MobileActorContext = {
  userId: string;
  role: UserRole;
  permissions: ReadonlySet<string>;
  branch:
    | { state: "resolved"; branchId: number }
    | { state: "not_applicable" }
    | { state: "failed" };
  centers:
    | { state: "resolved"; centerIds: readonly number[] }
    | { state: "not_applicable" }
    | { state: "failed" };
  deviceSessionId: string;
  scopeFingerprint: string;
};
```

ثم يطبق policy داخل Prisma `where` قبل `select`. لا يكفي:

- إخفاء شاشة أو tab
- فلترة DTO بعد query
- الاعتماد على role فقط
- قبول patient ID ثم فحصه بعد جلب السجل

حتى اعتماد سياسة `mobilePatientWhere`، لا يوجد Mobile API للمراجعين.
أي scope بحالة `failed` يفشل مغلقاً. `not_applicable` قرار في matrix الدور،
ولا يعني `all`.

## نطاق Read-only MVP

### الشاشات

- تسجيل دخول Online وحالة session/lock
- الرئيسية حسب البطاقات المسموحة فعلياً
- «عملي اليوم»
- بحث/قائمة مراجع ضمن النطاق المعتمد فقط
- ملخص المراجع ورحلة المراجع
- تبويبات القراءة التي تمر policy والصلاحية ونطاق المركز
- التنبيهات المسموح فتح رابطها
- حالة الاتصال، آخر مزامنة، stale/expired state، وزر مزامنة يدوي
- logout مع wipe

### ليست ضمن الدفعة

- تعليم التنبيه مقروءاً إذا اعتُبر business write
- أي صرف، مخزون، مالية، موافقة، إدارة مستخدم، حذف، تجاوز، اعتماد نهائي،
  رفع طبي نهائي، أو workflow transition
- background push أو cloud notification
- تنزيل ملفات طبية إلى cache في Phase 1

## API surface المقترحة

لا تُنشأ routes قبل اجتياز البوابات:

| Method | Route | الغرض |
| --- | --- | --- |
| `POST` | `/api/mobile/v1/auth/login` | دخول online وتسجيل installation |
| `POST` | `/api/mobile/v1/auth/refresh` | rotation أحادي الاستخدام |
| `POST` | `/api/mobile/v1/auth/logout` | revoke الجلسة الحالية |
| `GET` | `/api/mobile/v1/bootstrap` | المستخدم والصلاحيات والنطاق وlease |
| `GET` | `/api/mobile/v1/snapshot` | snapshot قراءة كاملة ومحدودة |
| `GET` | `/api/mobile/v1/patients` | بحث online محدود عند الحاجة |
| `GET` | `/api/mobile/v1/patients/:id` | DTO ملخص بعد direct-ID guard |
| `GET` | `/api/mobile/v1/patients/:id/tabs/:tab` | تبويب قراءة محروس |

`snapshot` هو المسار الافتراضي للمزامنة في Phase 1. تُضاف cursor endpoints
تفصيلية فقط بعد إثبات حاجة الحجم ووجود tombstones موثوقة.

## الملكية ومنع تعارض Agents

بعد الموافقة:

| المالك | المسارات |
| --- | --- |
| الوكيل الرئيسي | القرارات، الدمج، docs، commits، والتقارير |
| mobile-implementer | `apps/mobile/**` فقط |
| server/API owner | `packages/mobile-contracts/**`, `src/lib/mobile/**`, `src/app/api/mobile/**`, واختباراتها |
| security-agent | read-only review |
| test-agent | الاختبارات بعد checkpoint؛ لا يعدل ملفات التنفيذ دون تكليف جديد |

لا يعدل وكيلان الملف نفسه بالتوازي. يُوقف mobile-implementer وtest-agent
حالياً لأن بوابة الأمن لم تجتز.

## مراحل التنفيذ بعد الموافقة

1. **Phase 0:** التصميم والمهارة وطلبات القرار — الحالية.
2. **Phase 1A:** migration المعتمدة + patient scope policy واختباراتهما.
3. **Phase 1B:** contracts وauth/API read-only.
4. **Phase 1C:** Expo scaffold، SQLCipher، SecureStore، wipe.
5. **Phase 1D:** snapshot sync والشاشات وoffline states.
6. **Phase 1E:** Android native QA build والاختبارات الأمنية/التكاملية.
7. **Phase 1F:** commit/push فقط؛ لا merge ولا production deployment.

كل مرحلة commit مستقل ولا تبدأ التالية إلا إذا كانت بواباتها PASS.

## Blockers وقرارات مطلوبة

- الموافقة على Prisma migration لجلسات الأجهزة.
- تحديد نطاق المراجع الفعلي للموبايل دون تغيير ضمني لصلاحيات الويب.
- اعتماد مصدر بيانات QA صناعي قابل للإثبات قبل أول live Mobile API.
- السماح لاحقاً بتثبيت Android SDK محلياً على VM التطوير.
- توفير HTTPS داخلي موثوق قبل أي production mobile pilot.
- تحديد قناة توزيع APK والتوقيع خارج Git؛ لا يلزم ذلك لـPhase 0.
