import test from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { matchesEditKeyword } from "../lib/edit-campaign/matcher.js";
import { verifySignature } from "../lib/edit-campaign/signature.js";
import { isUsablePdfUrl, readiness, buildDmText } from "../lib/edit-campaign/config.js";

test("EDIT yorumları algılanır (büyük/küçük harf, noktalama, ek kelime)", () => {
  for (const t of ["EDIT", "edit", "Edit", "Edit!", "edit gönder", "EDIT istiyorum", "  edit...  ", "🔥 EDIT 🔥", "EDİT", "ＥＤＩＴ", "edıt"]) {
    assert.equal(matchesEditKeyword(t), true, t);
  }
});

test("EDIT başka kelimenin içinde geçerse tetiklemez", () => {
  for (const t of ["edited", "credit", "editör", "editing yaptım", "reditto", "predit", "kredit", "", null, undefined, "ed it", "e.d.i.t"]) {
    assert.equal(matchesEditKeyword(t), false, String(t));
  }
});

test("webhook imzası: doğru, yanlış, eksik, farklı gövde", () => {
  const secret = "s3cret";
  const body = Buffer.from('{"entry":[{"id":"1"}]}');
  const good = "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
  assert.equal(verifySignature(body, good, secret), true);
  assert.equal(verifySignature(body, good, "other"), false);
  assert.equal(verifySignature(Buffer.from("{}"), good, secret), false);
  assert.equal(verifySignature(body, undefined, secret), false);
  assert.equal(verifySignature(body, "sha256=zz", secret), false);
  assert.equal(verifySignature(body, "sha1=" + good.slice(7), secret), false);
  assert.equal(verifySignature(body, good, ""), false);
});

test("PDF bağlantısı doğrulaması: örnek/yerel/yer tutucu reddedilir", () => {
  assert.equal(isUsablePdfUrl("https://cdn.ahmetcerit.ai/EDIT_Rehberi.pdf"), true);
  for (const u of ["", "http://site.com/a.pdf", "https://example.com/a.pdf", "https://localhost/a.pdf", "https://127.0.0.1/a.pdf",
    "https://your-domain.com/a.pdf", "{PDF_URL}", "https://x.com/a b.pdf", "not a url", "https://intranet/a.pdf"]) {
    assert.equal(isUsablePdfUrl(u), false, u);
  }
});

test("hazır olma kontrolü: eksik değişkenler sebep olarak listelenir", () => {
  const base = { mediaId: "1", pdfUrl: "https://cdn.site.io/a.pdf", accessToken: "t", appSecret: "s" };
  assert.equal(readiness(base).ready, true);
  assert.match(readiness({ ...base, mediaId: "" }).problems.join(), /EDIT_CAMPAIGN_MEDIA_ID/);
  assert.match(readiness({ ...base, pdfUrl: "" }).problems.join(), /EDIT_GUIDE_PDF_URL/);
  assert.match(readiness({ ...base, appSecret: "" }).problems.join(), /APP_SECRET/);
});

test("DM metni belirtilen içeriği ve bağlantıyı taşır", () => {
  const t = buildDmText("https://cdn.site.io/a.pdf");
  assert.match(t, /^🎬 Söz verdiğim Claude ile Video Edit Rehberi burada!/);
  assert.match(t, /📘 Rehberi aç:\nhttps:\/\/cdn\.site\.io\/a\.pdf/);
  assert.match(t, /İyi çalışmalar! 🚀$/);
});
