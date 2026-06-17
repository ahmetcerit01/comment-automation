# Instagram Comment-to-DM Automation

Node.js + Express tabanlı Instagram yorum → DM otomasyon botu.

## Kurulum

```bash
npm install
```

`.env` dosyasını doldurun:

```
ACCESS_TOKEN=<Instagram Graph API uzun ömürlü token>
VERIFY_TOKEN=ahmet_prompt_bot_2026
PORT=3000
```

Yerel çalıştırma:

```bash
npm run dev
```

---

## Render'a Deploy

1. GitHub repo'ya push edin.
2. Render → **New Web Service** → repo'yu bağlayın.
3. **Build Command:** `npm install`
4. **Start Command:** `npm start`
5. **Environment Variables** bölümüne `.env` değerlerini girin.
6. Deploy sonrası size bir URL verilir, örneğin:
   `https://comment-automation.onrender.com`

---

## Meta Dashboard Webhook Ayarları

### Adım 1 — App'i Açın

[Meta for Developers](https://developers.facebook.com/) → uygulamanızı seçin.

### Adım 2 — Webhooks Bölümüne Gidin

Sol menü → **Products → Webhooks** (veya Instagram bölümü altında **Webhooks**).

### Adım 3 — Callback URL ve Verify Token Girin

| Alan | Değer |
|---|---|
| **Callback URL** | `https://<RENDER_URL>/webhook/instagram` |
| **Verify Token** | `ahmet_prompt_bot_2026` |

Örnek:
```
Callback URL : https://comment-automation.onrender.com/webhook/instagram
Verify Token : ahmet_prompt_bot_2026
```

**Verify** butonuna tıklayın. Sunucu `hub.challenge` değerini geri gönderirse doğrulama başarılı olur.

### Adım 4 — Subscribe Edilecek Alanlar

Aşağıdaki alanları subscribe edin:

- `comments`
- `messages`
- `messaging_postbacks`

### Adım 5 — Instagram Permissions

App'in aşağıdaki izinlere sahip olduğundan emin olun:

- `instagram_basic`
- `instagram_manage_comments`
- `instagram_manage_messages`
- `pages_messaging`

---

## Akış Özeti

```
Kullanıcı yorum yazar ("prompt", "link", "site", "nasıl", "nasil")
    ↓
POST /webhook/instagram → handleCommentWebhook()
    ↓
sentReplies.json kontrolü (aynı comment_id için tekrar gönderme)
    ↓
sendFollowGateMessageToComment(commentId)
    ├─ URL button template dener (private reply)
    └─ Hata → fallback text + "Takip ettim ✅" quick reply (private reply)
    ↓
Kullanıcı "Takip ettim ✅" butonuna basar
    ↓
POST /webhook/instagram
    ├─ postback event  → handlePostbackWebhook()
    └─ message event   → handleMessageWebhook()
    ↓
replyBasedOnFollowStatus(igsid)
    ↓
checkFollowStatus(igsid) → is_user_follow_business
    ├─ true  → "İşte 🙌 Link burada" (normal DM)
    └─ false → "Henüz takip ettiğini göremiyorum 💥" + tekrar buton (normal DM)
```

---

## Buton ve Fallback Davranışı

**"Profili Aç" butonu:**
Önce Instagram Graph API'nin `button` template formatıyla URL button gönderilmeye çalışılır.
Eğer Instagram API veya hesap izinleri URL button'a izin vermezse, sistem otomatik olarak profil linkini düz metin şeklinde gönderir (fallback).
Her iki durumda da "Takip ettim ✅" quick reply butonu eklenir.

**"Takip ettim ✅" butonu:**
Kullanıcı bu butona her bastığında `is_user_follow_business` alanı Instagram User Profile API üzerinden yeniden kontrol edilir.
`true` ise promo linki gönderilir; `false` ise kullanıcı tekrar yönlendirilir ve buton bir kez daha gösterilir.
Duplicate koruması yoktur — kullanıcı istediği kadar tekrar deneyebilir.

---

## Private Reply vs Normal DM

| Durum | Yöntem |
|---|---|
| Yoruma ilk yanıt | Private reply (`recipient.comment_id`) |
| Takip kontrolü sonucu | Normal DM (`recipient.id`) |
| Hata/fallback ilk yanıt | Private reply (fallback text) |
| "Takip etmedim" uyarısı | Normal DM + retry quick reply |

---

## Console Log Etiketleri

| Etiket | Açıklama |
|---|---|
| `COMMENT WEBHOOK RECEIVED` | Yorum event'i geldi |
| `MESSAGE WEBHOOK RECEIVED` | Mesaj event'i geldi |
| `POSTBACK WEBHOOK RECEIVED` | Postback event'i geldi |
| `FOLLOW CHECK RESULT` | Takip durumu API yanıtı |
| `PRIVATE REPLY SENT` | Private reply başarıyla gönderildi |
| `NORMAL DM SENT` | Normal DM başarıyla gönderildi |
| `FALLBACK MESSAGE SENT` | Fallback mesaj gönderildi |

---

## Privacy Policy

Uygulama, Meta App Review sürecinde **Privacy Policy URL** alanı için bir endpoint sunar:

```
https://YOUR_RENDER_URL/privacy
```

Örnek:
```
https://comment-automation.onrender.com/privacy
```

Bu endpoint herhangi bir token gerektirmez; doğrudan tarayıcıda açılabilir.

---

## Notlar

- `sentReplies.json` aynı `comment_id` için tekrar private reply gönderilmesini engeller.
- `is_echo: true` olan mesajlar (botun kendi mesajlarının echo'su) otomatik olarak yoksayılır.
- Render free tier cold start olabilir; ilk istek ~30 sn gecikebilir.
