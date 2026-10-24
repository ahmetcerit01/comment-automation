#!/usr/bin/env bash
# EDIT kampanyası yardımcı betiği. ADMIN_TOKEN'ı ortam değişkeni olarak verin (ekrana yazdırılmaz).
#   ADMIN_TOKEN=... ./scripts/edit-go-live.sh media     → Reels'ın gerçek media ID'sini bul
#   ADMIN_TOKEN=... ./scripts/edit-go-live.sh status    → kampanya durumu (live, token, PDF, sayaçlar)
#   ADMIN_TOKEN=... ./scripts/edit-go-live.sh dry       → eski EDIT yorumlarını say (HİÇBİR ŞEY GÖNDERMEZ)
#   ADMIN_TOKEN=... ./scripts/edit-go-live.sh send      → uygun eski EDIT yorumlarına PDF'i private reply ile gönder
set -euo pipefail
: "${ADMIN_TOKEN:?ADMIN_TOKEN ortam değişkeni gerekli}"
BASE="${BASE:-https://comment-automation-awgv.onrender.com}"
SHORTCODE="${SHORTCODE:-De3y0gdJtyI}"
H=(-H "x-admin-token: ${ADMIN_TOKEN}")
case "${1:-}" in
  media)  curl -sS -m 120 "${H[@]}" "$BASE/admin/edit-campaign/find-media?shortcode=$SHORTCODE" ;;
  status) curl -sS -m 120 "${H[@]}" "$BASE/admin/edit-campaign" ;;
  dry)    curl -sS -m 120 -X POST "${H[@]}" "$BASE/admin/edit-campaign/backfill" ;;
  send)   curl -sS -m 180 -X POST "${H[@]}" "$BASE/admin/edit-campaign/backfill?send=1" ;;
  *) echo "kullanım: media | status | dry | send"; exit 1 ;;
esac
echo
