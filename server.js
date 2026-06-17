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
const INSTAGRAM_PROFILE_URL = "https://www.instagram.com/ahmetcerit.ai/";
const PROMO_LINK = "https://ai-prompt-hub-50231461829.europe-west2.run.app/";
const SENT_REPLIES_PATH = path.join(__dirname, "sentReplies.json");
const GRAPH_API = "https://graph.instagram.com/v25.0";

const TRIGGER_KEYWORDS = ["prompt", "link", "site", "nasıl", "nasil"];

const FOLLOW_CHECK_QUICK_REPLY = {
  content_type: "text",
  title: "Takip ettim ✅",
  payload: "CHECK_FOLLOW",
};

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
async function sendFollowGateMessageToComment(commentId) {
  try {
    await sendPrivateReplyToComment(commentId, {
      attachment: {
        type: "template",
        payload: {
          template_type: "button",
          text: "Selamlar, linki göndermem için önce profili takip etmen gerekiyor 👇",
          buttons: [
            {
              type: "web_url",
              url: INSTAGRAM_PROFILE_URL,
              title: "Profili Aç",
            },
            {
              type: "postback",
              title: "Takip ettim ✅",
              payload: "CHECK_FOLLOW",
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
        text: `Selamlar, linki göndermem için önce profili takip etmen gerekiyor 👇\n\nProfili buradan aç:\n${INSTAGRAM_PROFILE_URL}\n\nTakip ettikten sonra aşağıdaki "Takip ettim ✅" butonuna bas.`,
        quick_replies: [FOLLOW_CHECK_QUICK_REPLY],
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
  await callGraphAPI("/me/messages", {
    recipient: { id: igsid },
    message: { text },
  });
  console.log(`✅ NORMAL DM SENT → ${igsid}`);
}

// Kullanıcıya URL button template gönderir
async function sendButtonTemplateToUser(igsid) {
  return callGraphAPI("/me/messages", {
    recipient: { id: igsid },
    message: {
      attachment: {
        type: "template",
        payload: {
          template_type: "button",
          text: "Selamlar, linki göndermem için önce profili takip etmen gerekiyor 👇",
          buttons: [
            {
              type: "web_url",
              url: INSTAGRAM_PROFILE_URL,
              title: "Profili Aç",
            },
            {
              type: "postback",
              title: "Takip ettim ✅",
              payload: "CHECK_FOLLOW",
            },
          ],
        },
      },
    },
  });
}

// Kullanıcıya follow-gate mesajını normal DM olarak gönderir.
// Önce URL button template dener; hata alırsa fallback text + quick reply gönderir.
async function sendFollowGateMessageToUser(igsid) {
  try {
    await sendButtonTemplateToUser(igsid);
    console.log(`✅ NORMAL DM SENT (button template) → ${igsid}`);
  } catch (err) {
    console.error(`❌ Button template failed for DM: ${err.message}`);
    try {
      await callGraphAPI("/me/messages", {
        recipient: { id: igsid },
        message: {
          text: `Selamlar, linki göndermem için önce profili takip etmen gerekiyor 👇\n\nProfili buradan aç:\n${INSTAGRAM_PROFILE_URL}\n\nTakip ettikten sonra aşağıdaki "Takip ettim ✅" butonuna bas.`,
          quick_replies: [FOLLOW_CHECK_QUICK_REPLY],
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
async function replyBasedOnFollowStatus(igsid) {
  const profile = await checkFollowStatus(igsid);

  if (profile.is_user_follow_business === true) {
    await sendMessageToUser(
      igsid,
      `İşte 🙌 Link burada:\n\n${PROMO_LINK}\n\nİşine yararsa takipte kalmayı unutma 🚀`
    );
  } else {
    await callGraphAPI("/me/messages", {
      recipient: { id: igsid },
      message: {
        text: `Henüz takip ettiğini göremiyorum 💥\n\nÖnce profili takip et, sonra tekrar "Takip ettim ✅" butonuna bas.`,
        quick_replies: [FOLLOW_CHECK_QUICK_REPLY],
      },
    });
    console.log(`✅ NORMAL DM SENT (not following — retry prompt) → ${igsid}`);
  }
}

// ---------- Webhook event handlers ----------

async function handleCommentWebhook(commentData) {
  console.log("💬 COMMENT WEBHOOK RECEIVED:", JSON.stringify(commentData, null, 2));

  const commentId = commentData?.id;
  const commentText = (commentData?.text ?? "").toLowerCase();
  const commenterId = commentData?.from?.id;

  if (!commenterId || !commentId) {
    console.log("⚠️  Missing commenterId or commentId, skipping");
    return;
  }

  const hasTrigger = TRIGGER_KEYWORDS.some((kw) => commentText.includes(kw));
  if (!hasTrigger) return;

  const sentReplies = loadSentReplies();
  if (sentReplies[commentId]) {
    console.log(`⏭️  Already replied to comment ${commentId}, skipping`);
    return;
  }

  sentReplies[commentId] = { repliedAt: new Date().toISOString(), commenterId };
  saveSentReplies(sentReplies);

  console.log(`🎯 Trigger found in comment ${commentId} from ${commenterId}`);
  await sendFollowGateMessageToComment(commentId);
}

async function handleMessageWebhook(event) {
  console.log("📨 MESSAGE WEBHOOK RECEIVED:", JSON.stringify(event, null, 2));

  const senderId = event?.sender?.id;
  if (!senderId) return;

  const quickReplyPayload = event?.message?.quick_reply?.payload ?? "";
  const messageText = (event?.message?.text ?? "").toLowerCase().trim();

  const isFollowCheck =
    quickReplyPayload === "CHECK_FOLLOW" ||
    messageText.includes("takip ettim");

  if (isFollowCheck) {
    await replyBasedOnFollowStatus(senderId);
  }
}

async function handlePostbackWebhook(event) {
  console.log("🔘 POSTBACK WEBHOOK RECEIVED:", JSON.stringify(event, null, 2));

  const senderId = event?.sender?.id;
  const payload = event?.postback?.payload ?? "";

  if (!senderId) return;

  if (payload === "CHECK_FOLLOW") {
    await replyBasedOnFollowStatus(senderId);
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
      } else if (event?.message && !event.message.is_echo) {
        await handleMessageWebhook(event).catch((err) =>
          console.error("❌ handleMessageWebhook error:", err.message)
        );
      }
    }
  }
});

// ---------- Health check ----------

app.get("/", (req, res) => {
  res.json({ status: "ok", service: "instagram-comment-automation" });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
