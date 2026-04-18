export const HUMAN_COOKIE_NAME = "zonenew_human";
export const HUMAN_COOKIE_MAX_AGE_SECONDS = 300;

function getRequiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required.`);
  return v;
}

function base64UrlEncode(bytes: ArrayBuffer): string {
  const u8 = new Uint8Array(bytes);
  const b64 =
    typeof Buffer !== "undefined"
      ? Buffer.from(u8).toString("base64")
      : btoa(String.fromCharCode(...u8));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function hmacSha256Base64Url(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return base64UrlEncode(sig);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

function parseCookieHeader(cookieHeader: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  const raw = cookieHeader || "";
  if (!raw) return out;
  for (const part of raw.split(";")) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (!k) continue;
    out[k] = v;
  }
  return out;
}

export async function createHumanCookieValue(nowMs: number): Promise<string> {
  const secret = getRequiredEnv("HUMAN_COOKIE_SECRET");
  const ts = String(Math.floor(nowMs / 1000));
  const sig = await hmacSha256Base64Url(secret, ts);
  return `${ts}.${sig}`;
}

export async function isHumanVerified(req: Request, nowMs: number): Promise<boolean> {
  const secret = process.env.HUMAN_COOKIE_SECRET;
  // If no secret is configured (local dev), skip verification
  if (!secret) return true;

  const cookies = parseCookieHeader(req.headers.get("cookie"));
  const v = cookies[HUMAN_COOKIE_NAME];
  if (!v) return false;

  const [tsStr, sig] = v.split(".");
  if (!tsStr || !sig) return false;
  if (!/^[0-9]{1,16}$/.test(tsStr)) return false;

  const ts = Number(tsStr);
  if (!Number.isFinite(ts) || ts <= 0) return false;

  const age = Math.floor(nowMs / 1000) - ts;
  if (age < 0 || age > HUMAN_COOKIE_MAX_AGE_SECONDS) return false;

  const expected = await hmacSha256Base64Url(secret, tsStr);
  return timingSafeEqual(expected, sig);
}
