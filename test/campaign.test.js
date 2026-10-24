import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { createEditCampaign } from "../lib/edit-campaign/campaign.js";
import { JsonStore } from "../lib/edit-campaign/store.js";
import { GraphError } from "../lib/edit-campaign/graph.js";
import { PUBLIC_REPLY_TEXT } from "../lib/edit-campaign/config.js";

const MEDIA = "17900000000000001";
const PDF = "https://cdn.ahmetcerit.ai/EDIT_Rehberi.pdf";
const quiet = { log() {}, error() {} };

function setup({ file = null, config = {}, graphImpl } = {}) {
  const calls = [];
  const graph = {
    post: async (endpoint, body) => {
      calls.push({ endpoint, body });
      return graphImpl ? graphImpl(endpoint, body, calls) : { ok: true };
    },
  };
  const cfg = { name: "X", mediaId: MEDIA, pdfUrl: PDF, accessToken: "t", appSecret: "s", sendIntervalMs: 0, maxAttempts: 4, publicReplyEnabled: true, ...config };
  const store = new JsonStore(file, { logger: quiet });
  const campaign = createEditCampaign({ config: cfg, store, graph, logger: quiet, sleep: async () => {} });
  return { calls, store, campaign, cfg, graph };
}
const comment = (o = {}) => ({ id: "c1", text: "EDIT", from: { id: "u1", username: "user" }, media: { id: MEDIA }, ...o });

test("EDIT yorumu → private reply DM (PDF bağlantılı) + sonra herkese açık cevap", async () => {
  const { calls, campaign, store } = setup();
  assert.equal(await campaign.handleComment("ig1", comment()), true);
  await campaign.idle();
  assert.equal(calls.length, 2);
  assert.equal(calls[0].endpoint, "/me/messages");
  assert.deepEqual(calls[0].body.recipient, { comment_id: "c1" });
  assert.match(calls[0].body.message.text, new RegExp(PDF.replaceAll(".", "\\.")));
  assert.equal(calls[1].endpoint, "/c1/replies");
  assert.equal(calls[1].body.message, PUBLIC_REPLY_TEXT);
  const s = store.summary().stats;
  assert.deepEqual([s.edit_comments, s.unique_comments, s.dm_success, s.dm_failed], [1, 1, 1, 0]);
});

test("takip kontrolü yapılmaz: yalnızca mesaj gönderimi çağrılır", async () => {
  const { calls, campaign } = setup();
  await campaign.handleComment("ig1", comment());
  await campaign.idle();
  assert.ok(calls.every((c) => !/is_user_follow_business|follow/i.test(JSON.stringify(c))));
});

test("başka gönderideki EDIT yorumu tetiklemez ve eski akışa bırakılır (false)", async () => {
  const { calls, campaign } = setup();
  assert.equal(await campaign.handleComment("ig1", comment({ media: { id: "999" } })), false);
  assert.equal(await campaign.handleComment("ig1", comment({ media: undefined })), false);
  await campaign.idle();
  assert.equal(calls.length, 0);
});

test("EDIT içermeyen yorum eşleşmez; kelime içinde geçen edit eşleşmez", async () => {
  const { calls, campaign } = setup();
  assert.equal(await campaign.handleComment("ig1", comment({ text: "harika video" })), false);
  assert.equal(await campaign.handleComment("ig1", comment({ text: "credit" })), false);
  await campaign.idle();
  assert.equal(calls.length, 0);
});

test("aynı yorum tekrar gelirse ikinci DM gitmez", async () => {
  const { calls, campaign, store } = setup();
  await campaign.handleComment("ig1", comment());
  await campaign.handleComment("ig1", comment());
  await campaign.handleComment("ig1", comment());
  await campaign.idle();
  assert.equal(calls.filter((c) => c.endpoint === "/me/messages").length, 1);
  assert.equal(store.summary().stats.duplicate_webhooks, 2);
});

test("sunucu yeniden başlasa bile aynı yoruma tekrar DM gitmez (kalıcı kayıt)", async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "edit-")), "edit.json");
  const first = setup({ file });
  await first.campaign.handleComment("ig1", comment());
  await first.campaign.idle();
  const second = setup({ file }); // "yeniden başlatma": aynı dosyadan yeni store
  await second.campaign.handleComment("ig1", comment());
  await second.campaign.idle();
  assert.equal(second.calls.length, 0);
  assert.equal(second.store.summary().stats.duplicate_webhooks, 1);
  assert.equal(second.store.summary().stats.dm_success, 1);
});

test("yarım kalan gönderim yeniden başlatmada sürdürülür", async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "edit-")), "edit.json");
  const first = setup({ file });
  first.store.create("c9", { isReply: false }); // DM atılmadan süreç kapandı
  const second = setup({ file });
  assert.equal(second.campaign.resumePending(), 1);
  await second.campaign.idle();
  assert.equal(second.calls.filter((c) => c.endpoint === "/me/messages").length, 1);
});

test("DM başarısızsa herkese açık cevap yazılmaz; kalıcı hata tekrar denenmez", async () => {
  const { calls, campaign, store } = setup({
    graphImpl: async () => {
      throw new GraphError({ message: "no perm", status: 400, code: 200 });
    },
  });
  await campaign.handleComment("ig1", comment());
  await campaign.idle();
  assert.equal(calls.length, 1);
  assert.ok(!calls.some((c) => c.endpoint.endsWith("/replies")));
  const s = store.summary().stats;
  assert.deepEqual([s.dm_success, s.dm_failed, s.api_errors], [0, 1, 1]);
  assert.equal(campaign.summary().lastAuthError.code, 200); // izin sorunu açıkça raporlanır
});

test("geçici hata kontrollü yeniden denenir ve başarılı olursa tek DM sayılır", async () => {
  let n = 0;
  const { calls, campaign, store } = setup({
    graphImpl: async (endpoint) => {
      if (endpoint === "/me/messages" && ++n < 3) throw new GraphError({ message: "5xx", status: 500 });
      return { ok: true };
    },
  });
  await campaign.handleComment("ig1", comment());
  await campaign.idle();
  assert.equal(calls.filter((c) => c.endpoint === "/me/messages").length, 3);
  const s = store.summary().stats;
  assert.deepEqual([s.dm_success, s.dm_failed, s.api_errors], [1, 0, 2]);
});

test("sürekli geçici hata → maxAttempts sonunda başarısız sayılır", async () => {
  const { calls, campaign, store } = setup({
    graphImpl: async () => {
      throw new GraphError({ message: "rate", status: 400, code: 4 });
    },
  });
  await campaign.handleComment("ig1", comment());
  await campaign.idle();
  assert.equal(calls.length, 4);
  assert.equal(store.summary().stats.dm_failed, 1);
});

test("herkese açık cevap hatası DM'i etkilemez ve tekrar denenmez", async () => {
  const { calls, campaign, store } = setup({
    graphImpl: async (endpoint) => {
      if (endpoint.endsWith("/replies")) throw new GraphError({ message: "x", status: 400, code: 100 });
      return { ok: true };
    },
  });
  await campaign.handleComment("ig1", comment());
  await campaign.idle();
  assert.equal(calls.filter((c) => c.endpoint.endsWith("/replies")).length, 1);
  const s = store.summary().stats;
  assert.deepEqual([s.dm_success, s.public_reply_failed], [1, 1]);
});

test("yorum yanıtı (parent_id) için herkese açık cevap yazılmaz, DM gider", async () => {
  const { calls, campaign } = setup();
  await campaign.handleComment("ig1", comment({ parent_id: "p1" }));
  await campaign.idle();
  assert.deepEqual(calls.map((c) => c.endpoint), ["/me/messages"]);
});

test("hesabın kendi yorumu (otomatik cevap) işlenmez", async () => {
  const { calls, campaign } = setup();
  assert.equal(await campaign.handleComment("ig1", comment({ from: { id: "ig1" } })), true);
  await campaign.idle();
  assert.equal(calls.length, 0);
});

test("kampanya hazır değilken (PDF yok / geçersiz) hiçbir mesaj gitmez", async () => {
  for (const pdfUrl of ["", "https://example.com/a.pdf", "{PDF_URL}"]) {
    const { calls, campaign, store } = setup({ config: { pdfUrl } });
    assert.equal(await campaign.handleComment("ig1", comment()), true);
    await campaign.idle();
    assert.equal(calls.length, 0, pdfUrl);
    assert.equal(store.summary().stats.skipped_not_ready, 1);
  }
});

test("EDIT_CAMPAIGN_MEDIA_ID tanımlı değilse kampanya hiçbir yorumda çalışmaz", async () => {
  const { calls, campaign } = setup({ config: { mediaId: "" } });
  assert.equal(await campaign.handleComment("ig1", comment()), false);
  await campaign.idle();
  assert.equal(calls.length, 0);
});

test("depoda kişisel veri yok: yalnızca yorum ID'si, durum ve sayaçlar", async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "edit-")), "edit.json");
  const { campaign } = setup({ file });
  await campaign.handleComment("ig1", comment({ text: "EDIT lütfen", from: { id: "u-secret", username: "gizli_kullanici" } }));
  await campaign.idle();
  const raw = fs.readFileSync(file, "utf8");
  assert.ok(!raw.includes("u-secret") && !raw.includes("gizli_kullanici") && !raw.includes("lütfen"));
});
