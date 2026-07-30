# Tahili Mobile Security and Privacy

## قرار Phase 0

**FAIL — 0 Critical / 2 High مفتوحة.**

لا يسمح هذا القرار بتثبيت mobile dependencies أو إنشاء auth/API/scaffold.
هو لا يصف ثغرتين جديدتين في production الحالي؛ يصف متطلبين أمنيين غير
متوفرين لبناء Mobile API بالمواصفات المطلوبة.

## Findings

### SEC-MOB-001 — High — لا توجد جلسة جهاز دائمة

الدليل:

- `User.authVersion` في `prisma/schema.prisma` يبطل كل جلسات المستخدم، لا
  جهازاً واحداً.
- `src/lib/auth.ts` و`src/lib/session-validation.ts` يخصان NextAuth/JWT
  للويب.
- `Device` جهاز طبي للمراجع و`DisplayDevice` شاشة طابور، ولا يجوز تغيير
  معناهما أو إعادة استخدامهما.

الأثر:

- لا device registration/revocation موثوق.
- لا refresh-token rotation أو reuse detection دائمة بعد restart.
- لا audit صحيح لكل device session.

العلاج المطلوب:

- موافقة منفصلة على model/migration مخصصين.
- credentials عشوائية وhashes فقط في الخادم.
- revocation وrotation transactional.

الطلب: `docs/specs/MOBILE_DEVICE_SESSION_SCHEMA_REQUEST.md`.

### SEC-MOB-002 — High — لا توجد patient-scope policy مركزية

الدليل:

- `src/lib/branch-context.ts` يعامل الفرع كفلتر، و`branch=all` يزيله.
- قائمة وتفاصيل المراجع تتحقق أساساً من `patients.view`.
- `src/lib/patient-tab-loader.ts` يطبق نطاق المركز على بعض العلاقات فقط.
- `/api/queue/today` لا يقدم predicate فرع/مركز موحداً.

الأثر:

إعادة استخدام استعلامات الويب قد ترسل بيانات مراجع خارج الحد الأدنى اللازم
للدور أو الإسناد. فلترة الواجهة بعد الاستلام لا تعالج التسريب.

العلاج المطلوب:

- قرار تشغيلي موثق لنطاق Mobile.
- `mobilePatientWhere(actor)` و`assertMobilePatientAccess` fail-closed.
- تطبيق predicate داخل query واختبار direct IDs.

الطلب: `docs/specs/MOBILE_PATIENT_SCOPE_POLICY_REQUEST.md`.

## نموذج التهديد

| التهديد | الحد الأمني |
| --- | --- |
| هاتف مفقود أو مسروق | SQLCipher، SecureStore، app lock، lease قصيرة، revocation |
| نسخ ملفات التطبيق أو backup | تعطيل backup/transfer، DB مشفرة، المفتاح خارج DB |
| اعتراض LAN | HTTPS موثوق في الإنتاج؛ QA فقط على HTTP التطوير |
| token theft/replay | access قصير memory-only، refresh rotation، hash، family revoke |
| حساب أو صلاحية تغيرت | تحقق user/`authVersion`/permissions/scope بكل request |
| تخمين patient ID | direct-ID guard داخل query وresponse بلا payload عند الرفض |
| client معدل | لا ثقة بإخفاء الشاشة أو local role؛ الخادم يعيد التحقق |
| dependency compromise | pins وlockfile وaudit/license review وno remote scripts |
| log/telemetry leak | allowlist حقول، Request ID فقط، لا cloud telemetry |
| sync جزئية أو replay قديم | snapshot manifest، staging/swap، expiry وscope fingerprint |
| screenshot/app switcher | secure screen flag وprivacy overlay |
| clock rollback | server lease مع monotonic receipt time حيث أمكن |

## الهوية والجلسات

### Login

- Online فقط.
- يعاد استخدام تحقق كلمة سر Tahili وقفل الحساب بعد فصله إلى helper server-only
  واختباره لضمان تطابق الويب والموبايل.
- لا تخزن كلمة السر ولا تعاد بعد request.
- لا يسجل username أو body أو user agent خام.
- development login يقبل حسابات QA allowlisted فقط.

### Access credential

- عشوائي أو signed design يراجع مستقلاً؛ التفضيل opaque random.
- عمر 5–10 دقائق.
- في الذاكرة فقط.
- لا AsyncStorage أو SQLite أو SecureStore للـaccess token.
- كل request يتحقق من device session ثم user active/activation/authVersion
  والصلاحيات والنطاق.

### Refresh credential

- 256-bit من CSPRNG.
- SecureStore/Keychain فقط.
- hash خادمي؛ لا raw token في DB أو logs.
- rotation أحادي الاستخدام داخل transaction.
- يحتفظ الخادم بـhashes generations المستهلكة حتى الانتهاء المطلق، كي يميز
  replay دقيقاً بعد restart من token عشوائي لا يطابق أي صف.
- reuse يلغي family/device session ويجبر wipe.
- timeout مطلق لنوبة العمل؛ لا silent indefinite renewal.

### Revocation

- logout يوقف sync ويمسح محلياً في مسار unconditional حتى عند انقطاع الشبكة
  أو فشل server revoke. إذا كان online يحاول revoke أولاً، لكن الـwipe لا
  ينتظر نجاحه.
- logout offline لا يدعي إلغاء الخادم؛ تبقى session حتى الانتهاء المطلق أو
  إلغاء إداري، ولا يحتفظ الجهاز بـcredential أو pending revoke بعد wipe.
- admin/security revoke يمنع refresh وAPI فوراً عند الاتصال.
- account disable، `authVersion` change، permission/scope change تعامل
  كأحداث session invalidation.
- لا in-memory registry أو ملف JSON كبديل للـDB.

## SQLCipher وSecureStore

### إنشاء المفتاح

1. أنشئ 32 bytes عشوائية من API المنصة.
2. حوّلها إلى hex بصيغة يتحقق منها regex ثابت قبل بناء `PRAGMA key`.
3. خزّنها في SecureStore فقط.
4. افتح DB ثم طبق المفتاح فوراً قبل أي query آخر.
5. تحقق من `PRAGMA cipher_version`.
6. فعّل foreign keys وWAL وفق اختبار SQLCipher.
7. شغّل integrity check في اختبارات التهيئة.

لا يظهر المفتاح في exception أو console أو test snapshot.

### إعداد المنصة

- Expo config plugin: `expo-sqlite` مع `useSQLCipher: true`.
- SQLCipher لا يعمل في Expo Go؛ يلزم native development build.
- Android `allowBackup=false`، ولا cloud backup أو device transfer.
- SecureStore Android يستخدم Keystore؛ لا توجد exportable app key.
- iOS Keychain accessibility تكون
  `SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY`. لا background sync في Phase 1،
  فلا يوجد مبرر لبقاء مفتاح DB متاحاً بعد إعادة قفل الجهاز.
- لأن Keychain قد يبقى بعد uninstall، يستخدم install sentinel غير حساس؛
  غيابه مع وجود مفاتيح قديمة يؤدي إلى حذفها وبدء clean install.
- راجع ترخيص SQLCipher Community وملف notices قبل commit/APK.

### Wipe

الأحداث: logout، lease expiry، refresh reuse، device revoke، account disable،
authVersion mismatch، corrupted DB، أو explicit security reset.

الترتيب:

1. أوقف sync وامسح access token من الذاكرة.
2. أغلق كل DB handles.
3. احذف refresh credential وDB key وinstall/session markers من SecureStore.
4. احذف DB و`-wal` و`-shm`.
5. احذف cache/temp/downloads.
6. تحقق أن reopen بلا key لا يقرأ canary.

هذا **crypto-shredding**. لا ندعي secure physical erase من flash.

## حماية الواجهة

- Arabic RTL افتراضياً مع light/dark.
- Android `FLAG_SECURE`/الحل المتوافق مع Expo للشاشات التي تعرض PHI.
- privacy overlay عند background/app switcher.
- lock بعد inactivity وعودة foreground، ضمن session/lease.
- لا نسخ clinical text إلى clipboard.
- لا share sheet أو export أو screenshot debug لبيانات QA/PHI.
- accessibility labels لا تحتوي identifiers في OS logs.
- push notifications غير موجودة في Phase 1؛ لا Firebase/APNs content.

## الشبكة

### Development

- API origin من build config منضبط، وليس hard-coded في code.
- origin واحد من LAN التطوير عند الاختبار.
- HTTP يسمح فقط في development flavor وQA synthetic allowlist.
- لا build development لموظفين أو بيانات حقيقية.

### Production

- **BLOCKED** حتى وجود HTTPS داخلي موثوق على Android/iOS.
- production manifest/network config يرفض cleartext.
- لا تعديل DNS/Caddy/FRP/MikroTik ضمن هذا المشروع.
- لا certificate pinning قبل وجود lifecycle/rotation runbook؛ TLS trust
  المعتمد شرط أدنى.

### Destination allowlist

APK لا تتصل إلا بـAPI origin الداخلي المحدد. تحظر:

- Expo updates/EAS
- Firebase/Sentry/analytics
- remote fonts/images
- public DNS-dependent service
- arbitrary URL from server data

CORS ليس مطلوباً لتطبيق native ولا يوسع.

## API controls

كل Route Handler محمي يمر wrapper واحداً:

```text
Request ID
-> method/content-type/size checks
-> bearer/device session
-> user/authVersion
-> permission store
-> branch/center/assignment scope
-> Zod request
-> bounded Prisma select
-> Zod response
-> no-store response
-> redacted aggregate audit
```

- fail closed عند تعذر session/permission store (`503` بلا data).
- `401/403/404/409/429/503` contracts ثابتة ولا تكشف وجود مراجع.
- لا cache/static generation للبيانات.
- لا dynamic SQL أو unbounded `findMany`.
- لا patient ID في route logs؛ route template فقط.
- لا CORS wildcard.
- login/refresh/snapshot request size limits صغيرة وثابتة.
- rate limits للمستخدم/device/session وIP المنقح حيث يتوفر proxy موثوق.

إذا استثنى `src/proxy.ts` `/api/mobile/v1` من cookie flow، يجب أن يمنع اختبار
inventory أي handler لا يستدعي mobile bearer guard.

## Logging and audit

### مسموح

- timestamp
- environment/service
- normalized route template
- method/status/duration bucket
- proxy-minted Request ID
- bounded error code
- aggregate record counts
- device session record ID فقط إذا قرر review أنه opaque وغير قابل للربط

### ممنوع

- username/full name
- patient ID/file number/name
- device installation ID
- request/response bodies
- raw URL/query
- password/token/hash/key/cookie/authorization
- diagnosis, note, phone, center-sensitive content
- SQL/Prisma args
- exception message/stack إذا تحتوي input

تدقيق device/sync يجب أن يكون durable. لا يستخدم helper يبتلع write failure
لحدث revocation/rotation أمني.

## Dependency and license gate

قبل أول dependency commit:

1. pin exact versions compatible with one Expo SDK.
2. install from approved development source only.
3. run `npm audit --json` للجذر وللموبايل.
4. require 0 Critical/0 High.
5. generate direct/transitive license inventory.
6. review native code, install scripts, network SDKs, and permissions.
7. include required SQLCipher notices.
8. verify lockfiles contain no Git URLs, mutable branches, or credentials.
9. scan bundle/APK strings and network destinations.

Baseline root audit reported by Phase 0 security review: 0 vulnerabilities.
يعاد الفحص بعد أي dependency.

## Security acceptance

- 0 Critical / 0 High.
- refresh replay/device revoke/authVersion/account disable all deny and wipe.
- unauthorized role/direct patient ID receives no DTO.
- permission/center/assignment change invalidates cache.
- SQLCipher canary absent from DB/WAL/SHM and unreadable without key.
- Android backup/transfer disabled.
- process restart and reinstall behavior tested.
- no secrets/keys/tokens/PHI in Git, APK, logs, test artifacts.
- packet/destination test shows only approved internal origin.
- real Android device test complements emulator.
- production build cannot use HTTP.
