#!/bin/bash
# إرسال تذكيرات مواعيد الغد تلقائياً — يقرأ من النظام ثم يرسل عبر بوابتك
set -e
API="http://localhost:3000/api/reminders/due?key=${REMINDER_KEY:-CHANGE_ME}"

JSON=$(curl -s "$API")
echo "$JSON" | grep -q '"reminders"' || { echo "فشل الجلب: $JSON"; exit 1; }
command -v jq >/dev/null 2>&1 || { echo "نصّب jq:  apt install -y jq"; exit 1; }

echo "$JSON" | jq -c '.reminders[]' | while read -r row; do
  PHONE=$(echo "$row" | jq -r '.phone')
  MSG=$(echo "$row" | jq -r '.message')

  # ====== استبدل هذا بأمر بوابتك الفعلية (WhatsApp/SMS) ======
  # مثال WhatsApp Cloud API:
  # curl -s -X POST "https://graph.facebook.com/v19.0/<PHONE_NUMBER_ID>/messages" \
  #   -H "Authorization: Bearer <TOKEN>" -H "Content-Type: application/json" \
  #   -d "{\"messaging_product\":\"whatsapp\",\"to\":\"$PHONE\",\"type\":\"text\",\"text\":{\"body\":\"$MSG\"}}"
  echo "[تجريبي] إلى $PHONE: $MSG"
done
echo "[✓] انتهى الإرسال $(date '+%Y-%m-%d %H:%M')"
