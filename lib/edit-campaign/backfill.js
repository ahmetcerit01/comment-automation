import { matchesEditKeyword } from "./matcher.js";

const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

/**
 * Kampanya aktif olmadan önce gelen EDIT yorumlarını işler.
 * Yorumlar normal webhook ile AYNI yoldan (campaign.handleComment) geçer: tekrar kontrolü, kuyruk,
 * hız sınırı ve istatistikler aynıdır. Zorlanmaz: 7 günden eski, kendi yorumumuz, EDIT içermeyen
 * ve eski (takip kapılı) akışta zaten private reply gönderilmiş yorumlar atlanır.
 */
export async function backfillEditComments({ graph, campaign, mediaId, ownUsername, alreadyRepliedLegacy = () => false, dryRun = true, now = Date.now(), maxPages = 20 }) {
  const result = { scanned: 0, edit_matches: 0, skipped: { not_edit: 0, too_old: 0, own: 0, legacy_replied: 0, replies: 0 }, enqueued: 0, would_send: 0, dryRun };
  const base = `/${mediaId}/comments`;
  let endpoint = `${base}?fields=id,text,timestamp,username,parent_id&limit=50`;

  for (let page = 0; page < maxPages && endpoint; page++) {
    const res = await graph.get(endpoint);
    for (const c of res?.data ?? []) {
      result.scanned++;
      if (!matchesEditKeyword(c.text)) { result.skipped.not_edit++; continue; }
      result.edit_matches++;
      if (ownUsername && c.username === ownUsername) { result.skipped.own++; continue; }
      if (c.parent_id) { result.skipped.replies++; continue; }
      if (c.timestamp && now - Date.parse(c.timestamp) > SEVEN_DAYS - 3600_000) { result.skipped.too_old++; continue; }
      if (alreadyRepliedLegacy(c.id)) { result.skipped.legacy_replied++; continue; }
      if (dryRun) { result.would_send++; continue; }
      const handled = await campaign.handleComment(null, { id: c.id, text: c.text, media: { id: mediaId }, from: { id: c.username ? `u:${c.username}` : null } });
      if (handled) result.enqueued++;
    }
    const next = res?.paging?.next;
    endpoint = next ? next.replace(/^https:\/\/graph\.instagram\.com\/v[\d.]+/, "").replace(/([?&])access_token=[^&]*&?/, "$1").replace(/[?&]$/, "") : null;
  }
  return result;
}
