#!/bin/bash
cd /tahili-system
docker compose up -d --build && sleep 3 && systemctl restart frpc
echo "تم النشر وإعادة تشغيل النفق ✅"
