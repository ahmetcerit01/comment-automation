import { keywordMatches } from "./site-prompts.js";

const normalize = (value) => String(value || "").toLocaleLowerCase("tr-TR").replaceAll("ı", "i");
const CAPTION_OPENING = normalize("AI video araçlarına para ödemeyi bırak");

export async function resolveAnimationCampaign(mediaId, commentText, {
  accessToken,
  graphApi = "https://graph.instagram.com/v25.0",
  fetchImpl = fetch,
} = {}) {
  if (!keywordMatches(commentText, "animasyon")) return { campaignOwned: false, match: false };
  if (!/^\d{10,30}$/.test(String(mediaId ?? "")) || !accessToken) return { campaignOwned: false, match: false };
  const url = new URL(`${graphApi}/${mediaId}`);
  url.searchParams.set("fields", "caption,permalink");
  url.searchParams.set("access_token", accessToken);
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Animation media lookup failed (${response.status})`);
  const media = await response.json();
  const caption = normalize(media.caption);
  const campaignOwned = caption.includes(CAPTION_OPENING) &&
    caption.includes("yorumlara") && keywordMatches(caption, "animasyon") &&
    /^https:\/\/(?:www\.)?instagram\.com\/(?:reel|p)\/[A-Za-z0-9_-]{11}\/?/.test(String(media.permalink || ""));
  return { campaignOwned, match: campaignOwned };
}
