// EDIT kampanyası için yorum eşleştirme.
// Eski normalizeText'ten ayrı tutuldu: "EDİT" (Türkçe noktalı İ), tam genişlikli harfler ve
// emoji/noktalama gibi durumları da güvenle ele alır; mevcut kampanyaların davranışı değişmez.

export function normalizeForMatch(text) {
  return String(text ?? "")
    .replaceAll("ı", "i")
    .replaceAll("İ", "I")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // ğ→g, ü→u, ş→s, ö→o, ç→c ve birleşik noktalar
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// "edit" yalnızca tam kelime olarak eşleşir: "edit", "Edit!", "edit gönder", "EDIT istiyorum" → evet;
// "edited", "credit", "editör" → hayır.
export function matchesEditKeyword(text, keyword = "edit") {
  const normalized = normalizeForMatch(text);
  if (!normalized) return false;
  return normalized.split(" ").includes(normalizeForMatch(keyword));
}
