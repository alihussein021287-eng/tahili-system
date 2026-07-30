# Tahili Mobile Acceptance Matrix

## قواعد الحكم

- `PASS`: نُفذ الاختبار على السطح الحقيقي المطلوب ونجح.
- `FAIL`: finding أو test failure مفتوح.
- `BLOCKED`: prerequisite غير متوفر، ولا يحتسب نجاحاً.
- `NOT RUN`: لم تصل المرحلة إلى البوابة.

لا يتحول skipped/mock/emulator-only security check إلى PASS. لا يوجد production
build أو deploy في هذه المصفوفة.

## Phase 0 status — 2026-07-30

| Gate | الحالة | الدليل/المتبقي |
| --- | --- | --- |
| Repository inventory | PASS | قرئت مراجع الأدوار/workflows/access/tabs/journey/my-work والـobservability |
| Separate feature branch | PASS | `feature/mobile-offline` من نفس `origin/main` HEAD عند البداية |
| Existing worktree preserved | PASS | تغييرات Acceptance السابقة لم تُعدل أو تُstage |
| Production untouched | PASS | لا production URL/service/data/infra call |
| Real medical data untouched | PASS | لا DB query/write أو fixture creation |
| Prisma/workflow/role changes | PASS | لا تغيير |
| Architecture design | PASS | `docs/MOBILE_ARCHITECTURE.md` |
| Offline design | PASS | `docs/MOBILE_OFFLINE_SYNC.md` |
| Skill | PASS | `quick_validate.py`: `Skill is valid!` |
| Root TypeScript baseline | PASS | `npx tsc --noEmit` |
| Existing Vitest baseline | PASS | 61 files / 328 tests |
| Root dependency audit | PASS | 0 vulnerabilities بجميع الدرجات؛ mobile dependencies لم تثبت |
| Development `/login` | PASS | LAN IP المعتمد أعاد `200` |
| Development health | PASS | containers بلا restart، migrations up to date، وhealth-check read-only |
| Security review | **FAIL** | 0 Critical / 2 High: device session وpatient scope |
| Dependency install | BLOCKED | ممنوع قبل إغلاق High findings |
| Android toolchain | BLOCKED | Android SDK/adb/sdkmanager غير مثبت |
| QA-only mobile data source | BLOCKED | لا علامة QA موثوقة بالاسم؛ يلزم مصدر صناعي معزول أو ضمان وallowlist خادمية |
| Production transport | BLOCKED | HTTPS داخلي موثوق غير مثبت؛ HTTP QA development فقط |

دليل التنفيذ: base revision و`origin/main` كانا
`d3fd1e376a1e64f52d4de9155208d7a5f21a8f0a`، وسجلت النتائج في
`2026-07-30T13:35:47+03:00`. الأوامر هي `quick_validate.py`,
`npx tsc --noEmit`, `npm test`, `npm audit --json`,
`curl .../login`، و`bash scripts/health-check.sh`. كان worktree يحتوي تغييرات
Acceptance سابقة محفوظة ولم تدخل نطاق هذه المرحلة.

## Architecture and scope gates

| ID | Acceptance | الاختبار/الدليل |
| --- | --- | --- |
| ARC-01 | الخادم هو المصدر الرسمي؛ لا PostgreSQL على الهاتف | source review + APK/file inventory |
| ARC-02 | mobile في `apps/mobile` والعقود runtime-neutral | dependency graph test |
| ARC-03 | كل API تحت `/api/mobile/v1` | route inventory |
| ARC-04 | لا Server Actions imports/calls في mobile | static import/network test |
| ARC-05 | لا Prisma/server-only import في contracts/mobile | dependency boundary test |
| ARC-06 | API origin من config منضبط بلا fallback ثابت | config unit + bundle scan |
| ARC-07 | development/production IDs وnetwork policy منفصلة | generated manifest/config diff |
| ARC-08 | iOS source-compatible؛ no signed claim على Linux | TypeScript/config validation + documented blocker |

## Authentication and device gates

| ID | Acceptance | الاختبار |
| --- | --- | --- |
| AUTH-01 | login online فقط ولا تخزن password | integration + storage scan |
| AUTH-02 | access token 5–10 دقائق وmemory-only | fake clock + storage scan |
| AUTH-03 | refresh 256-bit في SecureStore فقط وhash خادمي | unit/integration + DB projection |
| AUTH-04 | refresh rotation أحادي الاستخدام | concurrent refresh test |
| AUTH-05 | refresh reuse يلغي family ويجبر wipe | replay E2E |
| AUTH-06 | device registration دائمة عبر restart | API/DB integration |
| AUTH-07 | current/admin device revoke يمنع API وrefresh | integration + Android E2E |
| AUTH-08 | `authVersion`/inactive/needsActivation يرفض | matrix integration |
| AUTH-09 | session expiry يقفل التطبيق offline | Android fake clock/process restart |
| AUTH-10 | login/refresh/sync rate limits و`Retry-After` | burst/concurrency tests |
| AUTH-11 | fail-closed عند تعذر session/permission store | 503 contract test بلا payload |
| AUTH-12 | logout offline يمسح محلياً ولا يدعي server revoke | network-off Android E2E + server session assertion |

## Authorization and data minimization gates

| ID | Acceptance | الاختبار |
| --- | --- | --- |
| ACL-01 | 15 roles: server checks effective permissions | generated role matrix |
| ACL-02 | RolePermission/UserPermission overrides فورية بعد sync | integration |
| ACL-03 | branch/center/assignment predicate داخل query | repository call assertions + DB tests |
| ACL-04 | direct patient ID خارج النطاق لا يرجع record | 403/404 negative integration |
| ACL-05 | unauthorized user receives no PHI payload | raw response assertions |
| ACL-06 | tab policy يطابق `patient-tab-policy.ts` | contract parity test |
| ACL-07 | center scoped tab rows لا تتجاوز membership | membership DB tests |
| ACL-08 | notifications تمر `canOpenNotification` server-side | unit/integration |
| ACL-09 | DTOs minimal ولا ترجع Prisma rows | Zod output + forbidden-field tests |
| ACL-10 | unbounded lists غير موجودة | source/query limit tests |

الأدوار المطلوبة: `ADMIN`, `MANAGER`, `DOCTOR`, `RESIDENT`,
`HEAD_THERAPIST`, `THERAPIST`, `RECEPTION`, `DATA_ENTRY`, `PHARMACIST`,
`ACCOUNTANT`, `LAB`, `RADIOLOGY`, `DRESSING`, `PROSTHETICS`, و`VIEWER`.

## Contracts and API gates

| ID | Acceptance | الاختبار |
| --- | --- | --- |
| API-01 | request/response/error schemas strict Zod | contract tests |
| API-02 | invalid content type/size/body rejected | Route Handler tests |
| API-03 | responses الطبية `no-store` | header tests |
| API-04 | stable v1 envelope/version | compatibility fixtures |
| API-05 | 401/403/404/409/429/503 لا تكشف record | snapshot tests |
| API-06 | every protected mobile route uses bearer guard | route source inventory |
| API-07 | CORS غير موسع | header/source test |
| API-08 | Request ID من proxy فقط ومنقح | proxy/handler test |
| API-09 | no username/patient ID/body/token في logs | canary log test |
| API-10 | server output validates before send | invalid repository DTO test |
| API-11 | proxy يمرر opaque bearer للـguard بلا NextAuth redirect | proxy/Route Handler integration + web regression |

## Encryption and wipe gates

| ID | Acceptance | الاختبار |
| --- | --- | --- |
| ENC-01 | SQLCipher enabled in native binary | `cipher_version` on Android |
| ENC-02 | DB لا تقرأ بلا key أو بمفتاح خاطئ | native integration |
| ENC-03 | canary plaintext غير موجود في DB/WAL/SHM | file byte scan |
| ENC-04 | key 256-bit داخل SecureStore فقط | key lifecycle test |
| ENC-05 | Android backup/device transfer disabled | merged manifest/data rules |
| ENC-06 | iOS `WHEN_UNLOCKED_THIS_DEVICE_ONLY` + install sentinel | source/config + macOS/device later |
| ENC-07 | AsyncStorage لا يحمل PHI/token | static/runtime storage audit |
| ENC-08 | logout يغلق ويمسح key/token/DB/WAL/SHM/cache | Android E2E |
| ENC-09 | revoke/replay/expiry تستخدم نفس wipe path | Android E2E |
| ENC-10 | screenshot/app switcher/clipboard محمية | device interaction test |

## Offline and sync gates

| ID | Acceptance | الاختبار |
| --- | --- | --- |
| SYN-01 | authorized bounded snapshot فقط | API DB integration |
| SYN-02 | staging ثم atomic swap | injected failure tests |
| SYN-03 | partial/corrupt snapshot لا تستبدل الصالحة | process/network fault tests |
| SYN-04 | scope fingerprint change يمسح القديم | membership/permission change E2E |
| SYN-05 | TTL/stale/expired states واضحة | fake clock UI tests |
| SYN-06 | offline start بعد sync ثم network off | Android process restart |
| SYN-07 | reconnect ينفذ refresh/sync single-flight | network flapping test |
| SYN-08 | manual sync respects current state/rate limit | UI/integration |
| SYN-09 | outbox business enqueue/dispatch مرفوض | unit + DB count |
| SYN-10 | business counts قبل/بعد متطابقة | approved aggregate queries |
| SYN-11 | revoked device offline يقفل عند lease expiry | fake clock + restart |
| SYN-12 | cache يضم minimum role/scope records فقط | per-role DB/cache comparison |

## UI and device gates

| ID | Acceptance | الاختبار |
| --- | --- | --- |
| UI-01 | Arabic RTL في كل شاشة | Android phone/tablet |
| UI-02 | light/dark/system readable | visual assertions بلا screenshots shared |
| UI-03 | phone + tablet responsive بلا clipping | emulator/device viewports |
| UI-04 | loading/empty/error/offline/stale/expired/revoked | component + device tests |
| UI-05 | home cards حسب effective permissions | role matrix |
| UI-06 | my-work order/dedupe parity | shared fixture parity |
| UI-07 | patient journey derived parity | `patient-journey` contract tests |
| UI-08 | tabs حسب permission/center scope | navigation + direct API negative |
| UI-09 | connection + last sync + manual sync واضح | offline/reconnect E2E |
| UI-10 | process/background/foreground lock | real device |

## Network, dependency, and artifact gates

| ID | Acceptance | الاختبار |
| --- | --- | --- |
| NET-01 | APK يتصل بالـinternal API origin فقط | destination metadata capture |
| NET-02 | لا Expo/Firebase/Sentry/cloud/update calls | offline boot + destination scan |
| NET-03 | production cleartext denied | merged network security config |
| NET-04 | development cleartext origin واحد QA فقط | negative destination test |
| DEP-01 | exact pinned versions + reproducible lockfile | clean `npm ci` |
| DEP-02 | `npm audit`: 0 Critical / 0 High | root + mobile audit |
| DEP-03 | licenses inventoried and approved | license report |
| DEP-04 | SQLCipher attribution/notices included | APK/source notice review |
| ART-01 | no secrets/credentials/signing keys in Git | tracked-file secret scan |
| ART-02 | no secrets/tokens/PHI in APK strings/assets | unpacked APK scan |
| ART-03 | local Gradle build succeeds without cloud | isolated/offline build after cache |
| ART-04 | Android install/launch succeeds | emulator + real device |
| ART-05 | iOS source compatibility retained | TypeScript/config; signed build deferred |

## Existing Tahili regression gates

| ID | Acceptance | الاختبار |
| --- | --- | --- |
| WEB-01 | root TypeScript PASS | `npx tsc --noEmit` |
| WEB-02 | relevant unit/integration PASS | targeted Vitest |
| WEB-03 | auth/permissions/patient policies PASS | targeted suites |
| WEB-04 | route inventory صفر unclassified | `node scripts/audit-project.mjs` |
| WEB-05 | `/login` development LAN returns 200 | `scripts/health-check.sh`/approved curl |
| WEB-06 | targeted smoke no 500/Prisma errors | development LAN + redacted logs |
| WEB-07 | existing business counts unchanged | before/after aggregate evidence |
| WEB-08 | production untouched | release/environment evidence |

## Final release decision

Android APK يسمى **داخلياً مقبولاً** فقط إذا:

- كل Critical/High مغلقة.
- كل required gate أعلاه PASS أو بند iOS المؤجل موثق بوضوح.
- لا skipped native/security tests.
- commit وAPK checksum وdependency/license reports موثقة.
- لا production deployment أو signing secret في Git.
