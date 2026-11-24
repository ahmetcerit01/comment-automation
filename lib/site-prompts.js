const SAMPLE_MARKER = "UYARLANABİLİR ÖRNEK PROMPT\n\n";
const DEFAULT_SITE_URL = "https://icerik-studyosu-121126.exuberantnectarine2.chatgpt.site";

function reelCode(link) {
  try {
    const url = new URL(link);
    if (!["instagram.com", "www.instagram.com"].includes(url.hostname)) return null;
    return url.pathname.match(/\/(?:reel|reels|p)\/([A-Za-z0-9_-]{11})(?:\/|$)/)?.[1] ?? null;
  } catch {
    return null;
  }
}

function keywordMatches(comment, keyword) {
  const normalized = String(comment || "").toLocaleLowerCase("tr-TR");
  const needle = String(keyword || "").toLocaleLowerCase("tr-TR");
  if (!/^[\p{L}\p{N} ]{2,30}$/u.test(needle)) return false;
  return new RegExp(`(^|[^\\p{L}\\p{N}])${needle}($|[^\\p{L}\\p{N}])`, "u").test(normalized);
}

export async function findSitePrompt(mediaId, {
  accessToken,
  commentText,
  fetchImpl = fetch,
  graphApi = "https://graph.instagram.com/v25.0",
  siteUrl = DEFAULT_SITE_URL,
} = {}) {
  if (!/^\d{10,30}$/.test(String(mediaId ?? "")) || !accessToken) return null;
  const graphUrl = new URL(`${graphApi}/${mediaId}`);
  graphUrl.searchParams.set("fields", "permalink");
  graphUrl.searchParams.set("access_token", accessToken);
  const mediaResponse = await fetchImpl(graphUrl, { signal: AbortSignal.timeout(8000) });
  if (!mediaResponse.ok) throw new Error(`Instagram media lookup failed (${mediaResponse.status})`);
  const media = await mediaResponse.json();
  const code = reelCode(media?.permalink);
  if (!code) return null;

  const dataResponse = await fetchImpl(new URL("/api/data", siteUrl), { signal: AbortSignal.timeout(8000) });
  if (!dataResponse.ok) throw new Error(`Site content lookup failed (${dataResponse.status})`);
  const data = await dataResponse.json();
  const item = data?.items?.find((entry) => entry?.published && reelCode(entry.videoUrl) === code && typeof entry.prompt === "string" && entry.prompt.trim());
  if (!item) return null;
  if (!Array.isArray(data.automationRules) || !data.automationRules.some((rule) =>
    rule.enabled && rule.itemId === item.id && keywordMatches(commentText, rule.keyword))) return null;
  const sample = item.prompt.startsWith(SAMPLE_MARKER);
  const prompt = (sample ? item.prompt.slice(SAMPLE_MARKER.length) : item.prompt).trim();
  if (!prompt || prompt.length > 10000) return null;
  return { title: String(item.title || "Bu Reel").slice(0,180), prompt, sample };
}

export function promptMessages({ title, prompt, sample }) {
  const heading = `${title} için kopyalanabilir ${sample ? "uyarlanabilir örnek " : ""}prompt:\n\n`;
  const parts = [];
  let remaining = prompt;
  while (remaining) {
    const capacity = parts.length === 0 ? 900 - heading.length : 900;
    parts.push((parts.length === 0 ? heading : "") + remaining.slice(0, capacity));
    remaining = remaining.slice(capacity);
  }
  return parts;
}

export const SITE_URL = DEFAULT_SITE_URL;
