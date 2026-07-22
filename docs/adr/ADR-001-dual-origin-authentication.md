# ADR-001: Dual-Origin Authentication

**Status:** Accepted
**Date:** 2026-07-23
**Affects:** NextAuth route, proxy, Docker environment, release checks

## Context

كل بيئة تحتاج دومين HTTPS canonical ووصول HTTP مباشر عبر IP داخلي. إعداد cookie ثابت في NextAuth v4 إما يكسر دخول IP أو يضعف cookie الدومين. كما أن `AUTH_TRUST_HOST` وحده يسمح لـHost غير موثوق بالتأثير في callback origin.

## Decision

- تثبيت زوجي البيئة في `src/lib/environment-access.ts` ومطابقتهما مع `NEXTAUTH_URL` و`NEXTAUTH_URL_INTERNAL`.
- تعقيم Host و`x-forwarded-*` قبل NextAuth ورفض أي origin غير معروف بالحالة `421`.
- إنشاء cookie Secure host-only للدومين وcookie غير Secure host-only للـIP.
- يعيد proxy تسمية cookie الـIP داخل request فقط إلى الاسم canonical الذي تقرؤه Server Components؛ لا يرسل alias إلى المتصفح.
- السماح بالـcallback داخل origin الطلب نفسه فقط.
- تنفيذ الفحوص الحية عبر IP حسب `ENVIRONMENTS.md` دون اختبار البنية الخارجية افتراضياً.

## Options Considered

| الخيار | الإيجابيات | السلبيات | الأثر التشغيلي |
| --- | --- | --- | --- |
| cookie غير Secure واحدة | بسيط | يضعف HTTPS ويرسل cookie غير آمنة للدومين | مرفوض |
| cookie Secure واحدة | آمن للدومين | لا تعمل على HTTP IP | مرفوض |
| خدمتا app منفصلتان | فصل كامل | تشغيل وصيانة مضاعفان | غير ضروري |
| اختيار ديناميكي مع allowlist | فصل صحيح ضمن خدمة واحدة | يحتاج proxy واختبارات | معتمد |

## Consequences

- إيجابي: يعمل IP والدومين مع فصل cookies ورفض open redirects.
- سلبي: إضافة بيئة جديدة تتطلب تحديث المصفوفة والاختبارات، ولا يكفي تغيير `.env` وحده.
- متابعة: تبقى الفحوص الحية عبر IP، ويعاد بناء الصورة عند تغيير المصفوفة.

## Validation

- اختبارات origins الأربعة ورفض Host/callback غير معروف.
- Playwright فعلي عبر IP لكل بيئة بعد النشر.
- التحقق من Secure/non-Secure وreload وServer Actions وتسجيل الخروج.
