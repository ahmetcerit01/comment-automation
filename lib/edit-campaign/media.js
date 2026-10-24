// Gönderi permalink'inden (shortcode) gerçek Graph API media ID'sini bulur.
// Shortcode asla doğrudan media ID olarak kullanılmaz.

export async function findMediaByShortcode(graph, shortcode, { maxPages = 10 } = {}) {
  if (!/^[A-Za-z0-9_-]{5,20}$/.test(shortcode ?? "")) throw new Error("invalid shortcode");
  let endpoint = "/me/media?fields=id,permalink,media_type,media_product_type,timestamp&limit=50";
  let scanned = 0;
  for (let page = 0; page < maxPages && endpoint; page++) {
    const res = await graph.get(endpoint);
    for (const m of res?.data ?? []) {
      scanned++;
      const link = m.permalink ?? "";
      // permalink: https://www.instagram.com/(p|reel|reels|tv)/<shortcode>/
      if (new RegExp(`/(p|reel|reels|tv)/${shortcode}/?(\\?|$)`).test(link)) {
        return { found: true, id: String(m.id), permalink: link, mediaType: m.media_type, productType: m.media_product_type, timestamp: m.timestamp, scanned };
      }
    }
    const next = res?.paging?.next;
    endpoint = next ? next.replace(/^https:\/\/graph\.instagram\.com\/v[\d.]+/, "").replace(/([?&])access_token=[^&]*&?/, "$1").replace(/[?&]$/, "") : null;
  }
  return { found: false, scanned };
}
