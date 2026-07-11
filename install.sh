#!/usr/bin/env bash
set -euo pipefail
G='\033[0;32m'; Y='\033[1;33m'; R='\033[0;31m'; N='\033[0m'
say(){ echo -e "${G}==>${N} $1"; }
warn(){ echo -e "${Y}!!${N} $1"; }
die(){ echo -e "${R}خطأ:${N} $1"; exit 1; }

[ "$(id -u)" -eq 0 ] || die "شغّل السكربت بصلاحية root."

# الانتقال لمجلد السكربت (جذر المشروع)
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# لو السكربت برّا المشروع، حاول فك الأرشيف
if [ ! -f docker-compose.yml ] && [ -f tahili-system.zip ]; then
  say "فك أرشيف المشروع..."; apt-get install -y unzip >/dev/null 2>&1 || true
  unzip -o tahili-system.zip >/dev/null && cd tahili-system
fi
[ -f docker-compose.yml ] || die "ما لقيت docker-compose.yml — حط install.sh داخل مجلد المشروع."
[ -f .env ] || die "ملف .env غير موجود في مجلد المشروع."

say "تحديث النظام وتثبيت الأساسيات..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y && apt-get upgrade -y
apt-get install -y curl unzip ca-certificates

if ! command -v docker >/dev/null 2>&1; then
  say "تثبيت Docker..."
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker >/dev/null 2>&1 || true

# تحقق إن Docker شغّال فعلاً (مهم داخل LXC — يحتاج nesting)
if ! docker info >/dev/null 2>&1; then
  die "Docker لا يعمل. داخل LXC فعّل nesting من مضيف Proxmox:
       pct set <CTID> --features nesting=1,keyctl=1  ثم  pct reboot <CTID>"
fi

mkdir -p public uploads

say "بناء وتشغيل الحاويات (قد يأخذ عدة دقائق أول مرة)..."
docker compose up -d --build

# قراءة اسم مستخدم القاعدة من .env
DB_USER=$(grep -E '^DB_USER=' .env | cut -d= -f2- || echo tahili)

say "بانتظار جاهزية قاعدة البيانات..."
ok=0
for i in $(seq 1 40); do
  if docker compose exec -T postgres pg_isready -U "${DB_USER}" >/dev/null 2>&1; then ok=1; break; fi
  sleep 2
done
[ "$ok" -eq 1 ] || die "قاعدة البيانات لم تجهز. راجع: docker compose logs postgres"

say "إنشاء الجداول (prisma db push)..."
docker compose exec -T app npx prisma db push --accept-data-loss

say "إدخال البيانات الأولية (مستخدم admin + القوائم)..."
docker compose exec -T app npm run db:seed || warn "قد تكون البيانات الأولية موجودة مسبقاً."

# عناوين الوصول
IPS=$(hostname -I 2>/dev/null || echo "")
echo ""
echo -e "${G}====================================================${N}"
echo -e "${G}  تم التثبيت بنجاح ✅${N}"
echo -e "${G}====================================================${N}"
echo "  الوصول الداخلي عبر المتصفح:"
for ip in $IPS; do echo "    http://$ip:3000"; done
echo ""
echo "  تسجيل الدخول:  admin  /  كلمة السر من ADMIN_INITIAL_PASSWORD في .env"
echo -e "  ${Y}غيّر كلمة سر admin فوراً من إدارة المستخدمين.${N}"
echo ""
echo "  للإنترنت بالدومين: شغّل  bash setup-ssl.sh  بعد ضبط DNS و port-forward."
echo -e "${G}====================================================${N}"
