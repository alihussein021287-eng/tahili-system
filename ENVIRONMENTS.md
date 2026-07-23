# Tahili Environments

هذا الملف هو المرجع المركزي لعناوين الوصول والفحص. لا تستنتج عنواناً بديلاً من DNS أو Caddy أو إعداد قديم.

| البيئة | وصول LAN والفحص الحي | الدومين الرسمي | مسار الدومين |
| --- | --- | --- | --- |
| التطوير | `http://192.168.17.20:3000` | `https://tahili.elaqat.site` | FRP إلى VPS ثم Caddy |
| الإنتاج | `http://192.168.17.228:3000` | `https://tah.elaqat.site` | DNS MikroTik ثم Caddy محلي |

## إعدادات المصادقة

لكل بيئة:

- `NEXTAUTH_URL` هو الدومين الرسمي HTTPS ولا يتغير إلى IP.
- `NEXTAUTH_URL_INTERNAL` هو عنوان LAN لنفس البيئة.
- `NEXTAUTH_ALLOW_HTTP_LOGIN=true` يسمح بمسار LAN المعتمد فقط.
- `AUTH_TRUST_HOST=true` يعمل بعد تحقق التطبيق من Host/Proto مقابل المصفوفة الثابتة.
- الدومين يستخدم `__Secure-next-auth.session-token` مع `Secure` وبدون `Domain`.
- IP يستخدم `next-auth.session-token` بدون `Secure` وبدون `Domain`.
- لا تقبل المصادقة Host أو callback خارج زوج البيئة المحدد.

## قاعدة الفحص

- كل health check أو smoke test أو Playwright بعد النشر يستخدم عنوان LAN فقط.
- لا تستخدم `localhost` ما دام عنوان LAN متاحاً.
- لا ترسل فحصاً حياً إلى الدومين، ولا تفحص DNS أو FRP أو Caddy إلا بطلب صريح.
- عند وجود طلب صريح لتشخيص الدومين، يجوز فحص الدومين وDNS وFRP وCaddy الخاصة بالبيئة المطلوبة فقط؛ تبقى الفحوص الاعتيادية عبر IP.
- فشل DNS أو الدومين ليس مانعاً لفحص التطبيق الاعتيادي.

## مسار بروكسي التطوير

- اتصال FRP من `192.168.17.20` إلى `62.171.173.4` يجب أن يبقى عبر routing table `main`.
- يجب أن يحافظ بروكسي التطوير على `Host: tahili.elaqat.site` و`X-Forwarded-Host: tahili.elaqat.site` و`X-Forwarded-Proto: https`.
- أي تغيير في Caddy أو FRP لتشخيص دومين التطوير يقتصر على site/proxy الخاص بـ`https://tahili.elaqat.site`.

## الفصل بين البيئتين

لا تنسخ بين التطوير والإنتاج: `.env`، الأسرار، كلمات المرور، ملفات الاعتماد، قواعد البيانات، uploads، backups، volumes، إعدادات DNS/FRP/Caddy، أو عنوان `NEXTAUTH_URL_INTERNAL` و`TAHILI_LAN_IP`.

المنفذ `3000` مخصص للـLAN وloopback فقط. يربط compose هذين العنوانين صراحة ولا ينشئ forwarding عاماً.
