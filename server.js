import "dotenv/config";
import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const YKS_PDF_LINK = process.env.YKS_PDF_LINK;
const INSTAGRAM_PROFILE_URL = "https://www.instagram.com/ahmetcerit.ai/";
const SENT_REPLIES_PATH = path.join(__dirname, "sentReplies.json");
const GRAPH_API = "https://graph.instagram.com/v25.0";

const TRIGGER_KEYWORDS = [
  "prompt",
  "promt",
  "pormpt",
  "promot",
  "promtp",
  "link",
  "lnk",
  "site",
  "nasıl",
  "nasil",
  "gönder",
  "gonder",
  "göndersene",
  "gondersene",
  "gönderir misin",
  "gonderir misin",
  "atar mısın",
  "atar misin",
  "atarmısın",
  "atarmisin",
  "atsana",
  "at",
  "ver",
  "versene",
  "yolla",
  "yollar mısın",
  "yollar misin",
  "bana da",
  "banada",
  "istiyorum",
  "alabilir miyim",
  "alabilirmiyim",
  "ulaşabilir miyim",
  "ulasabilir miyim",
];

const YKS_TRIGGER_KEYWORDS = [
  "yks",
  "tyt",
  "ayt",
  "pdf",
  "turkce",
  "türkçe",
  "deneme",
  "son tekrar",
  "calisma kagidi",
  "çalışma kağıdı",
];

const PUBLIC_REPLY_VARIATIONS = [
  "Size ilettim 🙌",
  "DM'den gönderdim 🚀",
  "DM kutuna bıraktım, kontrol et 👀",
  "Gönderdim, DM'ini kontrol et 🔥",
];

function getPromptLink() {
  return process.env.PROMPT_LINK || "https://ai-prompt-hub-50231461829.europe-west2.run.app/";
}

function getRandomPublicReply() {
  return PUBLIC_REPLY_VARIATIONS[Math.floor(Math.random() * PUBLIC_REPLY_VARIATIONS.length)];
}

function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .replaceAll("ğ", "g")
    .replaceAll("ü", "u")
    .replaceAll("ş", "s")
    .replaceAll("ı", "i")
    .replaceAll("ö", "o")
    .replaceAll("ç", "c")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function includesKeywordFromList(text, keywords) {
  const normalizedText = normalizeText(text);
  if (!normalizedText) return false;

  const words = normalizedText.split(" ");

  return keywords.some((keyword) => {
    const normalizedKeyword = normalizeText(keyword);
    if (!normalizedKeyword) return false;

    // Çok kısa tetikleyiciler için includes kullanma.
    // Örn: "at" kelimesi "anlat", "katıl", "hatta" gibi kelimeleri yanlış tetikleyebilir.
    if (!normalizedKeyword.includes(" ") && normalizedKeyword.length <= 3) {
      return words.includes(normalizedKeyword);
    }

    if (!normalizedKeyword.includes(" ")) {
      return words.includes(normalizedKeyword);
    }

    return normalizedText.includes(normalizedKeyword);
  });
}

function includesTriggerKeyword(text) {
  return includesKeywordFromList(text, TRIGGER_KEYWORDS);
}

function includesYksTriggerKeyword(text) {
  return includesKeywordFromList(text, YKS_TRIGGER_KEYWORDS);
}

function getRequestTypeFromText(text) {
  if (includesYksTriggerKeyword(text)) return "yks";
  if (includesTriggerKeyword(text)) return "prompt";
  return null;
}

function getFollowCheckPayload(resourceType = "prompt") {
  return resourceType === "yks" ? "CHECK_FOLLOW_YKS" : "CHECK_FOLLOW_PROMPT";
}

function getFollowCheckQuickReply(resourceType = "prompt") {
  return {
    content_type: "text",
    title: "Takip ettim ✅",
    payload: getFollowCheckPayload(resourceType),
  };
}

function getFollowGateText(resourceType = "prompt") {
  if (resourceType === "yks") {
    return "Selamlar 👋 YKS son tekrar PDF’ini göndermem için önce profili takip etmen gerekiyor 👇";
  }

  return "Selamlar, linki göndermem için önce profili takip etmen gerekiyor 👇";
}

function getLinkMessage(resourceType = "prompt") {
  if (resourceType === "yks") {
    if (!YKS_PDF_LINK) {
      return "PDF linki henüz sisteme eklenmemiş görünüyor. Birazdan tekrar dener misin?";
    }

    return `Harika, PDF burada 👇\n\n📘 YKS Son Tekrar Türkçe Denemesi:\n${YKS_PDF_LINK}\n\nSınava girecek bir arkadaşın varsa ona da göndermeyi unutma. Başarılar 🚀`;
  }

  return `İşte 🙌 Link burada:\n\n${getPromptLink()}\n\nİşine yararsa takipte kalmayı unutma 🚀`;
}

// ---------- Safety helpers ----------

function getSelfIds() {
  return [
    process.env.IG_BUSINESS_ID,
    process.env.PAGE_ID,
    process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID,
  ]
    .filter(Boolean)
    .map(String);
}

function isSelfId(id) {
  if (!id) return false;
  return getSelfIds().includes(String(id));
}

function isSafeRecipientId(igsid) {
  if (!igsid) {
    console.log("🚫 BLOCKED_EMPTY_RECIPIENT");
    return false;
  }

  if (isSelfId(igsid)) {
    console.log(`🚫 BLOCKED_SELF_DM_ATTEMPT → ${igsid}`);
    return false;
  }

  return true;
}

function shouldIgnoreMessagingEvent(event) {
  const senderId = event?.sender?.id;
  const recipientId = event?.recipient?.id;

  if (!senderId) {
    console.log("🚫 MESSAGE_EVENT_WITHOUT_SENDER_IGNORED");
    return true;
  }

  if (event?.message?.is_echo === true) {
    console.log("🚫 ECHO_MESSAGE_IGNORED");
    return true;
  }

  if (isSelfId(senderId)) {
    console.log(`🚫 SELF_MESSAGE_IGNORED → ${senderId}`);
    return true;
  }

  if (senderId === recipientId) {
    console.log(`🚫 SENDER_EQUALS_RECIPIENT_IGNORED → ${senderId}`);
    return true;
  }

  return false;
}

// ---------- sentReplies helpers ----------

function loadSentReplies() {
  try {
    return JSON.parse(fs.readFileSync(SENT_REPLIES_PATH, "utf8"));
  } catch {
    return {};
  }
}

function saveSentReplies(data) {
  fs.writeFileSync(SENT_REPLIES_PATH, JSON.stringify(data, null, 2));
}

// ---------- Public comment reply ----------

async function replyToComment(commentId, message) {
  const url = `${GRAPH_API}/${commentId}/replies?access_token=${ACCESS_TOKEN}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(JSON.stringify(data));
  }
  return data;
}

// ---------- Low-level Graph API ----------

async function callGraphAPI(endpoint, body) {
  const url = `${GRAPH_API}${endpoint}?access_token=${ACCESS_TOKEN}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(JSON.stringify(data));
  }
  return data;
}

// ---------- Private reply functions (yorum → DM olarak) ----------

// Bir yoruma private reply gönderir (düşük seviye)
async function sendPrivateReplyToComment(commentId, messagePayload) {
  return callGraphAPI("/me/messages", {
    recipient: { comment_id: commentId },
    message: messagePayload,
  });
}

// Yoruma follow-gate mesajını private reply olarak gönderir.
// Önce URL button template dener; hata alırsa fallback text + quick reply gönderir.
async function sendFollowGateMessageToComment(commentId, resourceType = "prompt") {
  try {
    await sendPrivateReplyToComment(commentId, {
      attachment: {
        type: "template",
        payload: {
          template_type: "button",
          text: getFollowGateText(resourceType),
          buttons: [
            {
              type: "web_url",
              url: INSTAGRAM_PROFILE_URL,
              title: "Profili Aç",
            },
            {
              type: "postback",
              title: "Takip ettim ✅",
              payload: getFollowCheckPayload(resourceType),
            },
          ],
        },
      },
    });
    console.log(`✅ PRIVATE REPLY SENT (button template) → comment ${commentId}`);
  } catch (err) {
    console.error(`❌ Button template failed for private reply: ${err.message}`);
    try {
      await sendPrivateReplyToComment(commentId, {
        text: `${getFollowGateText(resourceType)}\n\nProfili buradan aç:\n${INSTAGRAM_PROFILE_URL}\n\nTakip ettikten sonra aşağıdaki "Takip ettim ✅" butonuna bas.`,
        quick_replies: [getFollowCheckQuickReply(resourceType)],
      });
      console.log(`✅ FALLBACK MESSAGE SENT (private reply) → comment ${commentId}`);
    } catch (fallbackErr) {
      console.error(`❌ Fallback private reply failed: ${fallbackErr.message}`);
    }
  }
}

// ---------- Normal DM functions (mesaj/postback yanıtları için) ----------

// Kullanıcıya düz metin DM gönderir
async function sendMessageToUser(igsid, text) {
  if (!isSafeRecipientId(igsid)) return;

  await callGraphAPI("/me/messages", {
    recipient: { id: igsid },
    message: { text },
  });
  console.log(`✅ NORMAL DM SENT → ${igsid}`);
}

// Kullanıcıya URL button template gönderir
async function sendButtonTemplateToUser(igsid, resourceType = "prompt") {
  if (!isSafeRecipientId(igsid)) return;

  return callGraphAPI("/me/messages", {
    recipient: { id: igsid },
    message: {
      attachment: {
        type: "template",
        payload: {
          template_type: "button",
          text: getFollowGateText(resourceType),
          buttons: [
            {
              type: "web_url",
              url: INSTAGRAM_PROFILE_URL,
              title: "Profili Aç",
            },
            {
              type: "postback",
              title: "Takip ettim ✅",
              payload: getFollowCheckPayload(resourceType),
            },
          ],
        },
      },
    },
  });
}

// Kullanıcıya follow-gate mesajını normal DM olarak gönderir.
// Önce URL button template dener; hata alırsa fallback text + quick reply gönderir.
async function sendFollowGateMessageToUser(igsid, resourceType = "prompt") {
  if (!isSafeRecipientId(igsid)) return;

  try {
    await sendButtonTemplateToUser(igsid, resourceType);
    console.log(`✅ NORMAL DM SENT (button template) → ${igsid}`);
  } catch (err) {
    console.error(`❌ Button template failed for DM: ${err.message}`);
    try {
      await callGraphAPI("/me/messages", {
        recipient: { id: igsid },
        message: {
          text: `${getFollowGateText(resourceType)}\n\nProfili buradan aç:\n${INSTAGRAM_PROFILE_URL}\n\nTakip ettikten sonra aşağıdaki "Takip ettim ✅" butonuna bas.`,
          quick_replies: [getFollowCheckQuickReply(resourceType)],
        },
      });
      console.log(`✅ FALLBACK MESSAGE SENT → ${igsid}`);
    } catch (fallbackErr) {
      console.error(`❌ Fallback DM failed: ${fallbackErr.message}`);
    }
  }
}

// ---------- Follow status check ----------

async function checkFollowStatus(igsid) {
  const url = `${GRAPH_API}/${igsid}?fields=name,username,is_user_follow_business&access_token=${ACCESS_TOKEN}`;
  const res = await fetch(url);
  const data = await res.json();

  console.log(`📊 FOLLOW CHECK RESULT for ${igsid}:`, JSON.stringify(data, null, 2));

  if (!res.ok) {
    throw new Error(JSON.stringify(data));
  }

  return data;
}

// Takip durumuna göre link ya da uyarı mesajı gönderir
async function replyBasedOnFollowStatus(igsid, resourceType = "prompt") {
  if (!isSafeRecipientId(igsid)) return;

  const profile = await checkFollowStatus(igsid);

  if (profile.is_user_follow_business === true) {
    await sendMessageToUser(igsid, getLinkMessage(resourceType));
  } else {
    await callGraphAPI("/me/messages", {
      recipient: { id: igsid },
      message: {
        text: `Henüz takip ettiğini göremiyorum 💥\n\nÖnce profili takip et, sonra tekrar "Takip ettim ✅" butonuna bas.`,
        quick_replies: [getFollowCheckQuickReply(resourceType)],
      },
    });
    console.log(`✅ NORMAL DM SENT (not following — retry prompt) → ${igsid}`);
  }
}

// ---------- Webhook event handlers ----------

async function handleCommentWebhook(commentData) {
  console.log("💬 COMMENT WEBHOOK RECEIVED:", JSON.stringify(commentData, null, 2));

  const commentId = commentData?.id;
  const commentText = commentData?.text ?? "";
  const commenterId = commentData?.from?.id;

  if (!commenterId || !commentId) {
    console.log("⚠️  Missing commenterId or commentId, skipping");
    return;
  }

  if (isSelfId(commenterId)) {
    console.log(`🚫 SELF_COMMENT_IGNORED → ${commenterId}`);
    return;
  }

  const requestType = getRequestTypeFromText(commentText);

  if (!requestType) {
    console.log(`🚫 NO TRIGGER KEYWORD FOUND: ${commentText}`);
    return;
  }

  console.log(`🎯 TRIGGER COMMENT DETECTED (${requestType}): ${commentText}`);

  const sentReplies = loadSentReplies();

  // Mevcut kaydı al ya da yeni oluştur
  if (!sentReplies[commentId]) {
    sentReplies[commentId] = {
      requestType,
      privateReplySent: false,
      publicReplySent: false,
      publicReplyText: null,
      createdAt: new Date().toISOString(),
    };
    saveSentReplies(sentReplies);
  }

  const record = sentReplies[commentId];

  // 1. Private reply — daha önce gönderilmediyse
  if (!record.privateReplySent) {
    sentReplies[commentId].privateReplySent = true;
    sentReplies[commentId].privateReplyMarkedAt = new Date().toISOString();
    saveSentReplies(sentReplies);

    await sendFollowGateMessageToComment(commentId, requestType);
  } else {
    console.log(`⏭️  DUPLICATE_PRIVATE_REPLY_IGNORED → comment ${commentId}`);
  }

  // 2. Public comment reply — daha önce gönderilmediyse
  if (!record.publicReplySent) {
    const publicReply = getRandomPublicReply();
    console.log(`📢 PUBLIC COMMENT REPLY SELECTED: ${publicReply}`);

    sentReplies[commentId].publicReplySent = true;
    sentReplies[commentId].publicReplyText = publicReply;
    sentReplies[commentId].publicReplyMarkedAt = new Date().toISOString();
    saveSentReplies(sentReplies);

    try {
      await replyToComment(commentId, publicReply);
      console.log(`✅ PUBLIC COMMENT REPLY SENT → comment ${commentId}`);
    } catch (err) {
      console.error(`❌ PUBLIC COMMENT REPLY FAILED → comment ${commentId}: ${err.message}`);
      console.error(`⚠️ Public reply will not be retried automatically to avoid duplicate comments.`);
    }
  } else {
    console.log(`⏭️  DUPLICATE_PUBLIC_REPLY_IGNORED → comment ${commentId}`);
  }
}

async function handleMessageWebhook(event) {
  console.log("📨 MESSAGE WEBHOOK RECEIVED:", JSON.stringify(event, null, 2));

  if (shouldIgnoreMessagingEvent(event)) return;

  const senderId = event?.sender?.id;

  const quickReplyPayload = event?.message?.quick_reply?.payload ?? "";
  const messageText = event?.message?.text ?? "";
  const messageTextLower = messageText.toLowerCase().trim();

  // 1. Quick reply veya "takip ettim" → mevcut follow-check akışı
  if (quickReplyPayload === "CHECK_FOLLOW" || quickReplyPayload === "CHECK_FOLLOW_PROMPT") {
    await replyBasedOnFollowStatus(senderId, "prompt");
    return;
  }

  if (quickReplyPayload === "CHECK_FOLLOW_YKS") {
    await replyBasedOnFollowStatus(senderId, "yks");
    return;
  }

  if (messageTextLower.includes("takip ettim")) {
    const requestType = getRequestTypeFromText(messageText) || "prompt";
    await replyBasedOnFollowStatus(senderId, requestType);
    return;
  }

  // 2. DM trigger keyword → takip kontrolüne göre link veya follow-gate
  const requestType = getRequestTypeFromText(messageText);

  if (requestType) {
    console.log(`📲 DM TRIGGER DETECTED (${requestType}): ${messageText}`);
    try {
      const profile = await checkFollowStatus(senderId);
      console.log(`📊 DM TRIGGER FOLLOW CHECK RESULT for ${senderId}`);

      if (profile.is_user_follow_business === true) {
        console.log(`✅ DM TRIGGER USER FOLLOWS, SENDING LINK → ${senderId}`);
        await sendMessageToUser(senderId, getLinkMessage(requestType));
      } else {
        console.log(`➡️ DM TRIGGER USER DOES NOT FOLLOW, SENDING FOLLOW GATE → ${senderId}`);
        await sendFollowGateMessageToUser(senderId, requestType);
      }
    } catch (err) {
      console.error(`❌ DM trigger follow check error: ${err.message}`);
    }
    return;
  }

  console.log(`🚫 DM NO TRIGGER FOUND: ${messageText}`);
}

async function handlePostbackWebhook(event) {
  console.log("🔘 POSTBACK WEBHOOK RECEIVED:", JSON.stringify(event, null, 2));

  if (shouldIgnoreMessagingEvent(event)) return;

  const senderId = event?.sender?.id;
  const payload = event?.postback?.payload ?? "";

  if (payload === "CHECK_FOLLOW" || payload === "CHECK_FOLLOW_PROMPT") {
    await replyBasedOnFollowStatus(senderId, "prompt");
    return;
  }

  if (payload === "CHECK_FOLLOW_YKS") {
    await replyBasedOnFollowStatus(senderId, "yks");
    return;
  }
}

// ---------- Webhook GET — verification ----------

app.get("/webhook/instagram", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  console.log("🔐 Webhook verification request:", { mode, token, challenge });

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook verified");
    return res.status(200).send(challenge);
  }

  console.error("❌ Webhook verification failed");
  res.sendStatus(403);
});

// ---------- Webhook POST — events ----------

app.post("/webhook/instagram", async (req, res) => {
  const body = req.body;
  console.log("📩 Incoming webhook payload:", JSON.stringify(body, null, 2));

  // 200 hemen döndürülür; Instagram aksi halde isteği tekrarlar
  res.sendStatus(200);

  const entries = body?.entry ?? [];

  for (const entry of entries) {
    // Comment events
    for (const change of entry?.changes ?? []) {
      const commentData = change?.value;
      if (!commentData) continue;

      const isComment =
        change?.field === "comments" ||
        change?.field === "mention_comments" ||
        commentData?.item === "comment";

      if (isComment) {
        await handleCommentWebhook(commentData).catch((err) =>
          console.error("❌ handleCommentWebhook error:", err.message)
        );
      }
    }

    // Message & postback events
    for (const event of entry?.messaging ?? []) {
      if (event?.postback) {
        await handlePostbackWebhook(event).catch((err) =>
          console.error("❌ handlePostbackWebhook error:", err.message)
        );
      } else if (event?.message) {
        await handleMessageWebhook(event).catch((err) =>
          console.error("❌ handleMessageWebhook error:", err.message)
        );
      }
    }
  }
});

// ---------- Privacy Policy ----------

app.get("/privacy", (req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Privacy Policy — Comment Automation</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #f9f9f9;
      color: #1a1a1a;
      line-height: 1.7;
    }
    .wrapper {
      max-width: 680px;
      margin: 60px auto;
      padding: 0 24px 80px;
    }
    header {
      border-bottom: 2px solid #e0e0e0;
      padding-bottom: 24px;
      margin-bottom: 40px;
    }
    header h1 {
      font-size: 1.75rem;
      font-weight: 700;
      letter-spacing: -0.3px;
    }
    header p {
      margin-top: 6px;
      color: #555;
      font-size: 0.9rem;
    }
    h2 {
      font-size: 1.05rem;
      font-weight: 600;
      margin: 36px 0 10px;
      color: #111;
    }
    p, li {
      font-size: 0.95rem;
      color: #333;
    }
    ul {
      padding-left: 20px;
    }
    ul li {
      margin-bottom: 6px;
    }
    .badge {
      display: inline-block;
      background: #1a1a1a;
      color: #fff;
      font-size: 0.75rem;
      font-weight: 600;
      padding: 3px 10px;
      border-radius: 999px;
      margin-bottom: 12px;
      letter-spacing: 0.4px;
    }
    footer {
      margin-top: 60px;
      border-top: 1px solid #e0e0e0;
      padding-top: 20px;
      font-size: 0.8rem;
      color: #888;
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <header>
      <span class="badge">Privacy Policy</span>
      <h1>Comment Automation</h1>
      <p>Son güncelleme: ${new Date().toLocaleDateString("tr-TR", { year: "numeric", month: "long", day: "numeric" })}</p>
    </header>

    <h2>Uygulama Hakkında</h2>
    <p>
      <strong>Comment Automation</strong>, <strong>Ahmet Cerit</strong> tarafından geliştirilen bir Instagram otomasyon uygulamasıdır.
      Bu uygulama, Instagram yorumlarını ve mesajlarını belirli tetikleyici kelimeler üzerinden izleyerek kullanıcılara otomatik DM gönderir.
    </p>

    <h2>Hangi Veriler İşlenir?</h2>
    <ul>
      <li>Yorum metni (tetikleyici kelime tespiti için)</li>
      <li>Instagram Scoped User ID (IGSID)</li>
      <li>Takip durumu (<code>is_user_follow_business</code>)</li>
      <li>Mesaj etkileşimleri (buton tıklamaları ve quick reply yanıtları)</li>
    </ul>

    <h2>Veriler Nasıl Kullanılır?</h2>
    <p>Toplanan veriler yalnızca aşağıdaki amaçlarla kullanılır:</p>
    <ul>
      <li>Tetikleyici kelime içeren yorumlara otomatik DM göndermek</li>
      <li>Kullanıcının profili takip edip etmediğini kontrol etmek</li>
      <li>Aynı yoruma birden fazla mesaj gönderilmesini önlemek (duplicate kontrolü)</li>
      <li>Link gönderme işlemini tamamlamak</li>
    </ul>

    <h2>Veri Paylaşımı</h2>
    <p>
      Kullanıcı verileri hiçbir üçüncü tarafa satılmaz, kiralanmaz veya pazarlama amacıyla paylaşılmaz.
      Veriler yalnızca bu otomasyonun çalışması için geçici olarak işlenir.
    </p>

    <h2>Kullanıcı Etkileşimi</h2>
    <p>
      Kullanıcılar bu otomasyon sistemiyle yalnızca Instagram üzerinden etkileşime girer:
      bir post veya Reels yorumu yaparak ya da gelen DM'e yanıt vererek.
      Sistem, yalnızca kullanıcının başlattığı etkileşimlere yanıt verir.
    </p>

    <h2>İletişim</h2>
    <p>
      Gizlilik politikasıyla ilgili sorularınız için Instagram üzerinden ulaşabilirsiniz:<br />
      <strong><a href="https://www.instagram.com/ahmetcerit.ai/" target="_blank" rel="noopener">@ahmetcerit.ai</a></strong>
    </p>

    <footer>
      &copy; ${new Date().getFullYear()} Ahmet Cerit &mdash; Comment Automation
    </footer>
  </div>
</body>
</html>`);
});

// ---------- Health check ----------

app.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "instagram-comment-automation",
    yksPdfConfigured: Boolean(YKS_PDF_LINK),
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
