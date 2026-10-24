import path from "path";

export const CAMPAIGN_NAME = "CLAUDE_REELS_EDIT_GUIDE";
export const TRIGGER_KEYWORD = "EDIT";
export const PUBLIC_REPLY_TEXT = "📩 Rehberi DM’den gönderdim!";

export function buildDmText(pdfUrl) {
  return (
    "🎬 İşte söz verdiğim Claude ile Video Edit Rehberi!\n\n" +
    "Bu PDF’de Claude Code kurulumu, adım adım video düzenleme yöntemi, her videoya uyarlanabilen hazır prompt " +
    "ve benim Reels’ımda kullandığım gerçek prompt bulunuyor.\n\n" +
    `📘 Ücretsiz rehber:\n${pdfUrl}\n\n` +
    "Kendi videonu hazırladığında beni etiketlemeyi unutma! 🚀"
  );
}

// Gerçek kullanıcılara örnek / yer tutucu / yerel bağlantı gönderilmesini engeller
export function isUsablePdfUrl(value) {
  if (!value || /\s/.test(value)) return false;
  let u;
  try {
    u = new URL(value);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || !host.includes(".")) return false;
  if (/(^|\.)(example\.(com|org|net)|invalid|test|local)$/.test(host)) return false;
  if (/(your|yourdomain|placeholder|pdf_url|xxx|changeme)/i.test(value)) return false;
  return true;
}

const num = (v, d) => (Number.isFinite(Number(v)) && v !== undefined && v !== "" ? Number(v) : d);

export function loadEditConfig(env = process.env, rootDir = process.cwd()) {
  return {
    name: CAMPAIGN_NAME,
    mediaId: (env.EDIT_CAMPAIGN_MEDIA_ID ?? "").trim(),
    pdfUrl: (env.EDIT_GUIDE_PDF_URL ?? "").trim(),
    appSecret: env.APP_SECRET ?? "",
    accessToken: env.ACCESS_TOKEN ?? "",
    adminToken: env.ADMIN_TOKEN ?? "",
    dataFile: path.join(env.DATA_DIR || path.join(rootDir, "data"), "edit-campaign.json"),
    sendIntervalMs: num(env.EDIT_SEND_INTERVAL_MS, 1200),
    maxAttempts: num(env.EDIT_MAX_ATTEMPTS, 4),
    publicReplyEnabled: env.EDIT_PUBLIC_REPLY !== "false",
  };
}

// Kampanya canlı sayılması için gerekenler. Eksik varsa hiçbir kullanıcıya mesaj gitmez.
export function readiness(cfg) {
  const problems = [];
  if (!cfg.mediaId) problems.push("EDIT_CAMPAIGN_MEDIA_ID tanımlı değil");
  if (!cfg.pdfUrl) problems.push("EDIT_GUIDE_PDF_URL tanımlı değil");
  else if (!isUsablePdfUrl(cfg.pdfUrl)) problems.push("EDIT_GUIDE_PDF_URL geçerli bir https bağlantısı değil (örnek/yerel/yer tutucu olamaz)");
  if (!cfg.accessToken) problems.push("ACCESS_TOKEN tanımlı değil");
  if (!cfg.appSecret) problems.push("APP_SECRET tanımlı değil (webhook imza doğrulaması için gerekli)");
  return { ready: problems.length === 0, problems };
}
