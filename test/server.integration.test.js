// Gerçek Express rotası üzerinden uçtan uca test. Instagram'a ASLA gerçek istek gitmez:
// graph.instagram.com çağrıları sahte (mock) fetch ile yakalanır.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "edit-int-"));
const MEDIA = "17900000000000001";
const SECRET = "test_app_secret";
Object.assign(process.env, {
  ACCESS_TOKEN: "TEST_TOKEN_NOT_REAL",
  VERIFY_TOKEN: "verify_me",
  APP_SECRET: SECRET,
  ADMIN_TOKEN: "admin_test",
  EDIT_CAMPAIGN_MEDIA_ID: MEDIA,
  EDIT_GUIDE_PDF_URL: "https://cdn.ahmetcerit.ai/EDIT_Rehberi.pdf",
  EDIT_SEND_INTERVAL_MS: "0",
  DATA_DIR: tmp,
  SENT_REPLIES_PATH: path.join(tmp, "sentReplies.json"),
});

const realFetch = globalThis.fetch;
const graphCalls = [];
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.startsWith("http://127.0.0.1")) return realFetch(url, init);
  if (u.startsWith("https://graph.instagram.com")) {
    graphCalls.push({ url: u, body: init?.body ? JSON.parse(init.body) : null });
    if (u.includes("is_user_follow_business")) return Response.json({ is_user_follow_business: false });
    return Response.json({ ok: true });
  }
  throw new Error(`UNEXPECTED NETWORK CALL: ${u}`);
};

const { app, editCampaign } = await import("../server.js");
let server, base;
before(async () => {
  await new Promise((r) => (server = app.listen(0, "127.0.0.1", r)));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const sign = (raw) => "sha256=" + crypto.createHmac("sha256", SECRET).update(raw).digest("hex");
async function post(payload, { signature } = {}) {
  const raw = JSON.stringify(payload);
  const res = await realFetch(`${base}/webhook/instagram`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(signature === null ? {} : { "X-Hub-Signature-256": signature ?? sign(raw) }) },
    body: raw,
  });
  await new Promise((r) => setTimeout(r, 50));
  await editCampaign.idle();
  return res.status;
}
const commentEvent = (id, text, media = MEDIA, from = "user1") => ({
  object: "instagram",
  entry: [{ id: "ig_business", time: 1, changes: [{ field: "comments", value: { id, text, from: { id: from, username: "u" }, media: { id: media, media_product_type: "REELS" } } }] }],
});
const msgCalls = () => graphCalls.filter((c) => c.url.includes("/me/messages"));
const reset = () => (graphCalls.length = 0);

test("webhook doğrulama (GET) çalışır; yanlış token reddedilir", async () => {
  const ok = await realFetch(`${base}/webhook/instagram?hub.mode=subscribe&hub.verify_token=verify_me&hub.challenge=abc`);
  assert.equal(await ok.text(), "abc");
  const bad = await realFetch(`${base}/webhook/instagram?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=abc`);
  assert.equal(bad.status, 403);
});

test("imzasız veya yanlış imzalı webhook reddedilir, hiçbir şey gönderilmez", async () => {
  reset();
  assert.equal(await post(commentEvent("s1", "EDIT"), { signature: null }), 401);
  assert.equal(await post(commentEvent("s2", "EDIT"), { signature: "sha256=" + "0".repeat(64) }), 401);
  assert.equal(graphCalls.length, 0);
});

test("EDIT yorumu kampanya Reels'ında: DM (private reply) + yoruma cevap, takip sorgusu yok", async () => {
  reset();
  assert.equal(await post(commentEvent("e1", "Edit!")), 200);
  const dm = msgCalls();
  assert.equal(dm.length, 1);
  assert.deepEqual(dm[0].body.recipient, { comment_id: "e1" });
  assert.match(dm[0].body.message.text, /https:\/\/cdn\.ahmetcerit\.ai\/EDIT_Rehberi\.pdf/);
  assert.ok(graphCalls.some((c) => c.url.includes("/e1/replies")));
  assert.ok(!graphCalls.some((c) => c.url.includes("is_user_follow_business") || JSON.stringify(c.body).includes("Takip ettim")));
});

test("aynı webhook tekrar gönderilirse ikinci DM gitmez", async () => {
  reset();
  await post(commentEvent("e1", "Edit!"));
  await post(commentEvent("e1", "Edit!"));
  assert.equal(msgCalls().length, 0);
});

test("'edit gönder' / 'EDIT istiyorum' kampanya Reels'ında eski takip kapısına DÜŞMEZ", async () => {
  reset();
  await post(commentEvent("e2", "edit gönder"));
  await post(commentEvent("e3", "EDIT istiyorum"));
  const dm = msgCalls();
  assert.equal(dm.length, 2);
  assert.ok(dm.every((c) => /Video Edit Rehberi/.test(c.body.message.text) && !c.body.message.attachment));
});

test("başka gönderideki 'EDIT' hiçbir şey tetiklemez", async () => {
  reset();
  await post(commentEvent("o1", "EDIT", "OTHER_MEDIA"));
  assert.equal(graphCalls.length, 0);
});

test("MEVCUT kampanyalar bozulmadı: başka gönderide 'prompt' yorumu hâlâ takip kapısı mesajı gönderir", async () => {
  reset();
  await post(commentEvent("l1", "prompt", "OTHER_MEDIA"));
  const dm = msgCalls();
  assert.equal(dm.length, 1);
  assert.deepEqual(dm[0].body.recipient, { comment_id: "l1" });
  assert.match(JSON.stringify(dm[0].body), /Takip ettim/);
});

test("MEVCUT kampanyalar bozulmadı: kampanya Reels'ında EDIT dışı eski tetikleyici ('link') eski akışa gider", async () => {
  reset();
  await post(commentEvent("l2", "link"));
  assert.match(JSON.stringify(msgCalls()[0]?.body), /Takip ettim/);
});

test("MEVCUT kampanyalar bozulmadı: YKS kelimesi eski akışa gider", async () => {
  reset();
  await post(commentEvent("y1", "yks pdf", "OTHER_MEDIA"));
  assert.match(JSON.stringify(msgCalls()[0]?.body), /YKS/);
});

test("kendi hesabımızın yorumu işlenmez", async () => {
  reset();
  await post(commentEvent("self1", "EDIT", MEDIA, "ig_business"));
  assert.equal(graphCalls.length, 0);
});

test("admin durum ucu: token olmadan 401, token ile rapor (gizli bilgi içermez)", async () => {
  assert.equal((await realFetch(`${base}/admin/edit-campaign`)).status, 401);
  const res = await realFetch(`${base}/admin/edit-campaign`, { headers: { "x-admin-token": "admin_test" } });
  const body = await res.json();
  assert.equal(body.live, true);
  assert.equal(body.stats.dm_success, 3);
  assert.equal(body.stats.duplicate_webhooks, 2);
  const raw = JSON.stringify(body);
  assert.ok(!raw.includes("TEST_TOKEN_NOT_REAL") && !raw.includes(SECRET) && !raw.includes("admin_test"));
});

test("sağlık ucu kampanya durumunu gösterir", async () => {
  const body = await (await realFetch(`${base}/`)).json();
  assert.equal(body.editCampaignLive, true);
});
