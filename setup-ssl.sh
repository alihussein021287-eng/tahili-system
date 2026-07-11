#!/usr/bin/env bash
set -euo pipefail
DOMAIN="tahili.elaqat.site"
EMAIL="admin@elaqat.site"   # غيّره لبريدك (لتنبيهات تجديد الشهادة)
G='\033[0;32m'; R='\033[0;31m'; N='\033[0m'
[ "$(id -u)" -eq 0 ] || { echo "شغّل بصلاحية root"; exit 1; }

echo -e "${G}==>${N} التأكد من أن الدومين يأشّر على هذا السيرفر..."
RES=$(getent hosts "$DOMAIN" | awk '{print $1}' | head -1 || true)
[ -n "$RES" ] || echo -e "${R}تنبيه:${N} $DOMAIN لا يُحَل حالياً — تأكد من DNS و port-forward (80/443) قبل المتابعة."

echo -e "${G}==>${N} تثبيت Nginx و Certbot..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y nginx certbot python3-certbot-nginx

cat > /etc/nginx/sites-available/tahili << NGINX
server {
    listen 80;
    server_name $DOMAIN;
    client_max_body_size 25M;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
NGINX

ln -sf /etc/nginx/sites-available/tahili /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

echo -e "${G}==>${N} إصدار شهادة SSL..."
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect
systemctl reload nginx
echo -e "${G}تم! افتح: https://$DOMAIN${N}"
