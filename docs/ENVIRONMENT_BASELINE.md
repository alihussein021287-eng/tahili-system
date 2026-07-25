# Development Environment Baseline

اللقطة: 2026-07-25، VM التطوير فقط. لا تحتوي أسراراً أو بيانات مرضى. أعد القياس بعد أي تنظيف أو تغيير بنية تحتية.

## Status

| المجال | القياس | التقييم |
| --- | --- | --- |
| CPU | 80 vCPU، Intel Xeon Gold 6230، load `0.52/0.47/0.79` | جاهز |
| RAM | 157 GiB، available 113 GiB | جاهز |
| Swap | 8 GiB، مستخدم قرابة 967 MiB | تحذير منخفض؛ راقب فقط |
| Disk | 492 GiB، مستخدم 103 GiB (22%)، متاح 364 GiB | جاهز |
| Inodes | 5% مستخدم | جاهز |
| Network | `eth0=192.168.17.20/24`, `eth1=10.220.170.20/24`; default عبر `192.168.17.1` | جاهز؛ الفحص الحي عبر eth0 فقط |
| OS/kernel | Ubuntu 24.04.4 LTS؛ kernel Proxmox `7.0.12-1-pve` | جاهز |
| Docker | 29.5.3؛ Compose 5.1.4 | جاهز |
| Node/npm | Node 20.20.2؛ npm 10.8.2 | جاهز |
| Next/Prisma | Next 16.2.10؛ Prisma 6.19.3 | جاهز؛ لا تنفذ major upgrade ضمن UI |
| PostgreSQL | 16.14؛ 16 migrations مطبقة | جاهز |
| MinIO | RELEASE.2025-09-07 | جاهز |
| ClamAV | 1.5.3؛ signatures 28072 | جاهز |
| LibreOffice | 25.8.1.1 داخل app image | جاهز |
| Containers | app/db/MinIO/ClamAV `running`, restart 0؛ ClamAV healthy | جاهز |
| Docker storage قبل التنظيف | images 86.08 GB؛ build cache 59.57 GB؛ reclaimable معلن 28.89/28.36 GB | تحذير؛ تنظيف انتقائي |
| Logs | app قرابة 11 KiB؛ Loki قرابة 294 MiB؛ البقية صغيرة | تحذير؛ اضبط rotation لاحقاً ولا تحذف log نشط |
| Backups | آخر DB/uploads بتاريخ 2026-07-25 02:00 | جاهز؛ لا تحذف |
| OOM/disk errors | لا نتائج حديثة في فحص kernel المحدد | جاهز |

## Cleanup Result

| القياس | قبل | بعد |
| --- | ---: | ---: |
| filesystem used | 103 GiB (22%) | 42 GiB (9%) |
| filesystem available | 364 GiB | 425 GiB |
| Docker images | 86.08 GB | 29.9 GB |
| reclaimable build cache | 28.36 GB ثم 10.01 GB بعد إزالة tags | 0 B |
| build cache retained/shared | 59.57 GB total | 21.21 GB active/shared |
| Tahili app tags | 17 | 3 |

المساحة المسترجعة على filesystem قرابة **61 GiB**. حُذف build cache غير المستخدم، 14 tag قديمة، قرابة 3 GiB من archives، وPlaywright/Office/test temp القديم. بقيت:

- `tahili-system-app:79aa9ab` (الإصدار المنشور الأخير).
- `tahili-system-app:latest` / image `bac1560…` (الصورة العاملة على التطوير).
- `tahili-system-app:5f0d4fb` (الصورة المستقرة السابقة).

كل الحاويات التسع بقيت عاملة، وكل volumes الثمانية بقيت active. `/login` و`/readiness` أعادا 200، migrations بقيت 16 ومحدثة، وapp/db/MinIO/ClamAV بقيت restart 0 بلا أخطاء تطبيق حديثة.

## Protected Assets

- كل Docker volumes وقواعد PostgreSQL وMinIO وuploads وbackups.
- `/root/tahili-role-acceptance-credentials.tsv` وأي اعتماد آخر.
- QA users/patients و`qa-mapping.tsv` والتقرير النهائي الأخير.
- image التطبيق العاملة وآخر الصور المستقرة المحددة قبل التنظيف.
- Git objects والمشروع وmigrations والمهارات.

## Production Baseline Checklist (Not Executed)

يتطلب موافقة إنتاج صريحة وجولة مستقلة:

- [ ] اقرأ `ENVIRONMENTS.md` و`PRODUCTION_CHECKLIST.md`.
- [ ] استخدم `http://192.168.17.228:3000` فقط.
- [ ] اجمع CPU/RAM/disk/inodes وDocker usage دون أسرار.
- [ ] سجل services/images/restarts/health وmigrations.
- [ ] سجل counts فقط قبل أي تغيير.
- [ ] افحص `/login` وAdmin routes والlogs عبر IP.
- [ ] نفذ dry-run تنظيف مستقل يحمي DB/MinIO/uploads/backups/credentials.
- [ ] لا تلمس domain/DNS/FRP/Caddy/MikroTik.
