import { matchesEditKeyword } from "./matcher.js";
import { buildDmText, PUBLIC_REPLY_TEXT, readiness } from "./config.js";

const RETRY_DELAYS_MS = [2000, 10000, 30000];
const RATE_LIMIT_PAUSE_MS = 60000;

/**
 * EDIT kampanyası: belirlenen Reels'a "EDIT" yazan kullanıcıya private reply ile PDF rehberini gönderir.
 *
 * Garantiler:
 *  - Yalnızca EDIT_CAMPAIGN_MEDIA_ID olan gönderide çalışır
 *  - Takip kontrolü yoktur (mevcut kampanyalardaki takip kapısına dokunulmaz)
 *  - Aynı yorum için en fazla bir DM: kayıt DM gönderilmeden ÖNCE kalıcı olarak yazılır
 *  - Herkese açık cevap yalnızca DM başarılı olduktan sonra yazılır
 *  - Kampanya hazır değilse (media ID / PDF bağlantısı / secret eksik) hiçbir mesaj gitmez
 */
export function createEditCampaign({
  config,
  store,
  graph,
  logger = console,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  now = () => Date.now(),
}) {
  let chain = Promise.resolve();
  let lastSendAt = 0;
  let lastAuthError = null;

  const status = () => readiness(config);

  async function pace() {
    const wait = lastSendAt + config.sendIntervalMs - now();
    if (wait > 0) await sleep(wait);
    lastSendAt = now();
  }

  async function sendPublicReply(commentId) {
    try {
      await graph.post(`/${commentId}/replies`, { message: PUBLIC_REPLY_TEXT });
      store.update(commentId, { publicReply: "sent" });
      store.incr("public_reply_success");
    } catch (err) {
      // Tekrar denenmez: yinelenen herkese açık yorum oluşmasın
      store.update(commentId, { publicReply: "failed" });
      store.incr("public_reply_failed");
      store.incr("api_errors");
      logger.error(`EDIT public reply failed: ${err.message}`);
    }
  }

  async function process(commentId) {
    const rec = store.get(commentId);
    if (!rec || rec.status !== "pending") return;

    for (let attempt = rec.attempts + 1; attempt <= config.maxAttempts; attempt++) {
      await pace();
      store.update(commentId, { attempts: attempt });
      try {
        await graph.post("/me/messages", {
          recipient: { comment_id: commentId },
          message: { text: buildDmText(config.pdfUrl) },
        });
        store.update(commentId, { status: "sent" });
        store.incr("dm_success");
        lastAuthError = null;
        logger.log(`EDIT DM sent (comment ${commentId}, attempt ${attempt})`);
        if (config.publicReplyEnabled && !rec.isReply) await sendPublicReply(commentId);
        return;
      } catch (err) {
        store.incr("api_errors");
        if (err.authProblem) lastAuthError = { code: err.code, at: new Date(now()).toISOString() };
        const willRetry = err.transient && attempt < config.maxAttempts;
        logger.error(`EDIT DM failed (comment ${commentId}, attempt ${attempt}, retry=${willRetry}): ${err.message}`);
        if (!willRetry) {
          store.update(commentId, { status: "failed", lastError: `code=${err.code ?? "?"} sub=${err.subcode ?? "-"}` });
          store.incr("dm_failed");
          return;
        }
        await sleep(err.rateLimited ? RATE_LIMIT_PAUSE_MS * attempt : RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)]);
      }
    }
  }

  function enqueue(commentId) {
    chain = chain.then(() => process(commentId)).catch((err) => logger.error(`EDIT queue error: ${err.message}`));
  }

  return {
    status,
    idle: () => chain,

    /**
     * @returns {Promise<boolean>} true → yorum bu kampanyaya ait (eski akışlara iletilmemeli)
     */
    async handleComment(entryId, comment) {
      if (!matchesEditKeyword(comment?.text)) return false;
      if (!config.mediaId || String(comment?.media?.id ?? "") !== config.mediaId) return false;

      const commentId = comment?.id ? String(comment.id) : null;
      const fromId = comment?.from?.id ? String(comment.from.id) : null;

      // Hesabın kendi yorumları (ör. otomatik cevaplar) asla işlenmez
      if (fromId && entryId && fromId === String(entryId)) return true;
      if (!commentId) return true;

      store.incr("edit_comments");

      const { ready, problems } = status();
      if (!ready) {
        store.incr("skipped_not_ready");
        logger.error(`EDIT campaign NOT LIVE, comment skipped: ${problems.join("; ")}`);
        return true;
      }

      if (store.has(commentId)) {
        store.incr("duplicate_webhooks");
        logger.log(`EDIT duplicate webhook ignored (comment ${commentId})`);
        return true;
      }

      // Kayıt gönderimden önce kalıcı yazılır → yeniden başlatma / tekrar webhook ikinci DM üretmez
      store.create(commentId, { isReply: Boolean(comment.parent_id) });
      store.incr("unique_comments");
      enqueue(commentId);
      return true;
    },

    // Sunucu yeniden başladığında yarım kalan gönderimleri sürdür
    resumePending() {
      if (!status().ready) return 0;
      const ids = store.pendingIds();
      ids.forEach(enqueue);
      return ids.length;
    },

    summary() {
      return { ...store.summary(), lastAuthError, queueActive: true };
    },
  };
}
