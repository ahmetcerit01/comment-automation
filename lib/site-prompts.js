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

export function keywordMatches(comment, keyword) {
  const normalized = String(comment || "").toLocaleLowerCase("tr-TR").replaceAll("ı", "i");
  const needle = String(keyword || "").toLocaleLowerCase("tr-TR").replaceAll("ı", "i");
  if (!/^[\p{L}\p{N} ]{2,30}$/u.test(needle)) return false;
  return new RegExp(`(^|[^\\p{L}\\p{N}])${needle}($|[^\\p{L}\\p{N}])`, "u").test(normalized);
}

export async function resolveSiteAutomation(mediaId, {
  accessToken,
  commentText,
  fetchImpl = fetch,
  graphApi = "https://graph.instagram.com/v25.0",
  siteUrl = DEFAULT_SITE_URL,
} = {}) {
  if (!/^\d{10,30}$/.test(String(mediaId ?? "")) || !accessToken) return { siteOwned: false, match: null };
  const graphUrl = new URL(`${graphApi}/${mediaId}`);
  graphUrl.searchParams.set("fields", "permalink");
  graphUrl.searchParams.set("access_token", accessToken);
  const mediaResponse = await fetchImpl(graphUrl, { signal: AbortSignal.timeout(8000) });
  if (!mediaResponse.ok) throw new Error(`Instagram media lookup failed (${mediaResponse.status})`);
  const media = await mediaResponse.json();
  const code = reelCode(media?.permalink);
  if (!code) return { siteOwned: false, match: null };

  const dataResponse = await fetchImpl(new URL("/api/data", siteUrl), { signal: AbortSignal.timeout(8000) });
  if (!dataResponse.ok) throw new Error(`Site content lookup failed (${dataResponse.status})`);
  const data = await dataResponse.json();
  const item = data?.items?.find((entry) => entry?.published && reelCode(entry.videoUrl) === code);
  if (!item) return { siteOwned: false, match: null };
  const rule = Array.isArray(data.automationRules) ? data.automationRules.find((entry) =>
    entry.enabled && entry.itemId === item.id && keywordMatches(commentText, entry.keyword)) : null;
  if (!rule || typeof item.prompt !== "string" || !item.prompt.trim()) return { siteOwned: true, match: null };
  const sample = item.prompt.startsWith(SAMPLE_MARKER);
  const prompt = (sample ? item.prompt.slice(SAMPLE_MARKER.length) : item.prompt).trim();
  if (!prompt || prompt.length > 10000) return { siteOwned: true, match: null };
  return { siteOwned: true, match: { id: item.id, title: String(item.title || "Bu Reel").slice(0,180), prompt, sample } };
}

export async function findSitePrompt(mediaId, options = {}) {
  return (await resolveSiteAutomation(mediaId, options)).match;
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
