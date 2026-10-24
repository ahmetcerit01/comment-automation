import crypto from "crypto";

// Meta webhook imzası: X-Hub-Signature-256 = "sha256=" + HMAC_SHA256(ham gövde, APP_SECRET)
export function verifySignature(rawBody, header, secret) {
  if (!secret || typeof header !== "string" || !header.startsWith("sha256=")) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody ?? Buffer.alloc(0)).digest();
  let received;
  try {
    received = Buffer.from(header.slice("sha256=".length), "hex");
  } catch {
    return false;
  }
  return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}

export function safeEqual(a, b) {
  const x = crypto.createHash("sha256").update(String(a ?? "")).digest();
  const y = crypto.createHash("sha256").update(String(b ?? "")).digest();
  return crypto.timingSafeEqual(x, y);
}
