// Instagram Graph API istemcisi (EDIT kampanyası için).
// - Token'ı hata mesajlarına / loglara sızdırmaz
// - Hataları sınıflandırır: geçici (yeniden denenebilir), rate limit, izin/token, kalıcı

const RATE_LIMIT_CODES = new Set([4, 17, 32, 341, 613]);
const AUTH_CODES = new Set([10, 102, 190, 200]); // izin yok / token geçersiz-süresi dolmuş

export class GraphError extends Error {
  constructor({ message, status = 0, code = null, subcode = null, network = false, isTransient = false }) {
    super(message);
    this.name = "GraphError";
    this.status = status;
    this.code = code;
    this.subcode = subcode;
    this.network = network;
    this.rateLimited = RATE_LIMIT_CODES.has(code) || status === 429;
    this.authProblem = AUTH_CODES.has(code) || status === 401 || status === 403;
    this.transient = network || this.rateLimited || status >= 500 || isTransient === true;
  }
}

export function createGraphClient({ accessToken, baseUrl = "https://graph.instagram.com/v25.0", timeoutMs = 15000 }) {
  const redact = (s) => (accessToken ? String(s).split(accessToken).join("***") : String(s));

  async function request(method, endpoint, body) {
    const url = `${baseUrl}${endpoint}${endpoint.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(accessToken ?? "")}`;
    let res;
    try {
      res = await globalThis.fetch(url, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new GraphError({ message: `network error (${err.name})`, network: true });
    }
    let data = null;
    try {
      data = await res.json();
    } catch {
      /* gövde JSON değil */
    }
    if (!res.ok) {
      const e = data?.error ?? {};
      throw new GraphError({
        message: redact(`Graph API ${res.status} code=${e.code ?? "?"} subcode=${e.error_subcode ?? "-"}: ${e.message ?? "error"}`),
        status: res.status,
        code: e.code ?? null,
        subcode: e.error_subcode ?? null,
        isTransient: e.is_transient,
      });
    }
    return data;
  }

  return {
    post: (endpoint, body) => request("POST", endpoint, body),
    get: (endpoint) => request("GET", endpoint),
  };
}
