import test from "node:test";
import assert from "node:assert/strict";
import { findMediaByShortcode } from "../lib/edit-campaign/media.js";
import { backfillEditComments } from "../lib/edit-campaign/backfill.js";

const SHORT = "De3y0gdJtyI";

test("shortcode permalink üzerinden gerçek media ID bulunur (shortcode ID olarak kullanılmaz)", async () => {
  const pages = {
    "/me/media?fields=id,permalink,media_type,media_product_type,timestamp&limit=50": {
      data: [{ id: "111", permalink: "https://www.instagram.com/p/AAAAAAAAAAA/" }],
      paging: { next: "https://graph.instagram.com/v25.0/me/media?fields=id,permalink&limit=50&after=XYZ&access_token=SECRET" },
    },
    "/me/media?fields=id,permalink&limit=50&after=XYZ": {
      data: [{ id: "17900000000000099", permalink: `https://www.instagram.com/reel/${SHORT}/`, media_product_type: "REELS" }],
    },
  };
  const graph = { get: async (e) => { assert.ok(!e.includes("SECRET")); return pages[e]; } };
  const r = await findMediaByShortcode(graph, SHORT);
  assert.deepEqual([r.found, r.id], [true, "17900000000000099"]);
  assert.notEqual(r.id, SHORT);
});

test("shortcode yoksa found=false; geçersiz shortcode reddedilir", async () => {
  const graph = { get: async () => ({ data: [{ id: "1", permalink: "https://www.instagram.com/p/OTHER12345/" }] }) };
  assert.equal((await findMediaByShortcode(graph, SHORT)).found, false);
  await assert.rejects(() => findMediaByShortcode(graph, "../x"));
});

const NOW = Date.parse("2026-10-24T12:00:00Z");
const iso = (daysAgo) => new Date(NOW - daysAgo * 86400000).toISOString();

function run(comments, opts = {}) {
  const handled = [];
  const campaign = { handleComment: async (e, c) => { handled.push(c.id); return true; } };
  const graph = { get: async () => ({ data: comments }) };
  return backfillEditComments({ graph, campaign, mediaId: "M1", ownUsername: "ahmetcerit.ai", now: NOW, ...opts }).then((r) => ({ r, handled }));
}

test("geriye dönük tarama: yalnızca uygun EDIT yorumları işlenir", async () => {
  const { r, handled } = await run([
    { id: "a", text: "EDIT", username: "u1", timestamp: iso(1) },
    { id: "b", text: "çok güzel", username: "u2", timestamp: iso(1) },
    { id: "c", text: "edit gönder", username: "u3", timestamp: iso(10) }, // 7 günden eski
    { id: "d", text: "EDIT", username: "ahmetcerit.ai", timestamp: iso(1) }, // kendi yorumumuz
    { id: "e", text: "Edit!", username: "u5", timestamp: iso(2) },
    { id: "f", text: "EDIT", username: "u6", timestamp: iso(1), parent_id: "a" }, // yanıt
    { id: "g", text: "edit", username: "u7", timestamp: iso(1) }, // eski akışta zaten private reply gitmiş
  ], { dryRun: false, alreadyRepliedLegacy: (id) => id === "g" });
  assert.deepEqual(handled, ["a", "e"]);
  assert.deepEqual([r.scanned, r.edit_matches, r.enqueued], [7, 6, 2]);
  assert.deepEqual(r.skipped, { not_edit: 1, too_old: 1, own: 1, legacy_replied: 1, replies: 1 });
});

test("dryRun hiçbir şey göndermez / kuyruğa almaz", async () => {
  const { r, handled } = await run([{ id: "a", text: "EDIT", username: "u1", timestamp: iso(1) }], { dryRun: true });
  assert.equal(handled.length, 0);
  assert.equal(r.would_send, 1);
});
