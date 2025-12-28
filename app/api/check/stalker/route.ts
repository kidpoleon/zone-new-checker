import { NextResponse } from "next/server";
import { fetchWithTimeout, safeJson } from "@/lib/http";
import { normalizeStalkerUrl, normalizeMac, parsePortFromOrigin } from "@/lib/validation";
import { lookup } from "dns/promises";

// This route uses Node-only APIs (dns/promises), so it must not run in the Edge runtime.
export const runtime = "nodejs";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
} as const;

function requireClient(req: Request): Response | null {
  const v = req.headers.get("x-zonenew-client");
  if (v !== "1") {
    return NextResponse.json({ ok: false, error: "Forbidden." }, { status: 403, headers: NO_STORE_HEADERS });
  }
  return null;
}

function asObj(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
}

function isReal(v: unknown): boolean {
  // Stalker portals frequently return placeholder values like "0", "null", or "0000-00-00 00:00:00".
  // This helper filters those out so our pickers don't show garbage in the UI.
  if (v === null || v === undefined) return false;
  const s = String(v).trim();
  if (!s) return false;
  if (s === "0" || s.toLowerCase() === "null" || s.toLowerCase() === "none") return false;
  if (s === "0000-00-00 00:00:00") return false;
  return true;
}

function isoDateFromMs(ms: number): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "N/A";
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function formatEpoch(v: string): string {
  const s = String(v).trim();
  if (!/^[0-9]{9,13}$/.test(s)) return s;

  let n = Number(s);
  if (!Number.isFinite(n)) return s;
  // Heuristic: milliseconds if 13 digits
  if (s.length >= 13) n = Math.floor(n / 1000);
  if (n <= 0) return "N/A";

  return isoDateFromMs(n * 1000);
}

function expiryTsFromEpoch(v: string): number | null {
  const s = String(v).trim();
  if (!/^[0-9]{9,13}$/.test(s)) return null;
  let n = Number(s);
  if (!Number.isFinite(n)) return null;
  if (s.length >= 13) n = Math.floor(n / 1000);
  if (n <= 0) return null;
  const t = n * 1000;
  return Number.isFinite(t) ? t : null;
}

function expiryTsFromMysqlDateTime(v: string): number | null {
  const m = /^([0-9]{4})-([0-9]{2})-([0-9]{2})\s+([0-9]{2}):([0-9]{2})(?::([0-9]{2}))?$/.exec(v);
  if (!m) return null;
  if (m[1] === "0000") return null;
  const yyyy = Number(m[1]);
  const mm = Number(m[2]);
  const dd = Number(m[3]);
  const hh = Number(m[4]);
  const mi = Number(m[5]);
  const ss = Number(m[6] || "0");
  if (!Number.isFinite(yyyy) || !Number.isFinite(mm) || !Number.isFinite(dd) || !Number.isFinite(hh) || !Number.isFinite(mi) || !Number.isFinite(ss)) return null;
  const t = Date.UTC(yyyy, mm - 1, dd, hh, mi, ss);
  return Number.isFinite(t) ? t : null;
}

function formatMysqlDateTime(v: string): string {
  // Input commonly: "YYYY-MM-DD HH:MM:SS". If invalid, return original.
  const m = /^([0-9]{4})-([0-9]{2})-([0-9]{2})\s+([0-9]{2}):([0-9]{2})(?::([0-9]{2}))?$/.exec(v);
  if (!m) return v;
  if (m[1] === "0000") return "N/A";

  const yyyy = Number(m[1]);
  const mm = Number(m[2]);
  const dd = Number(m[3]);
  const hh = Number(m[4]);
  const mi = Number(m[5]);
  const ss = Number(m[6] || "0");

  const d = new Date(Date.UTC(yyyy, mm - 1, dd, hh, mi, ss));
  if (Number.isNaN(d.getTime())) return v;

  return isoDateFromMs(d.getTime());
}

function pickExpiry(jsAccount: unknown, jsProfile: unknown): string {
  // Stalker portals are inconsistent: expiry may be epoch seconds, MySQL datetime,
  // or even shoved into unrelated fields (e.g. `phone`). We scan common candidates.
  const a = asObj(jsAccount);
  const p = asObj(jsProfile);
  const candidates = [
    a["expire_billing_date"],
    p["expire_billing_date"],
    // Some portals abuse `phone` to store expiry (MacAttack reads this)
    a["phone"],
    p["phone"],
    a["expire_date"],
    p["expire_date"],
    a["exp_date"],
    p["exp_date"],
  ];

  for (const c of candidates) {
    if (isReal(c)) {
      const s = String(c);
      if (/^[0-9]{9,13}$/.test(s)) return formatEpoch(s);
      // If it looks like MySQL datetime, format it.
      if (/^[0-9]{4}-[0-9]{2}-[0-9]{2}\s+[0-9]{2}:[0-9]{2}/.test(s)) {
        return formatMysqlDateTime(s);
      }
      return s;
    }
  }
  return "N/A";
}

function pickExpiryInfo(jsAccount: unknown, jsProfile: unknown): { expiryDate: string; expiryTs?: number } {
  const a = asObj(jsAccount);
  const p = asObj(jsProfile);
  const candidates = [
    a["expire_billing_date"],
    p["expire_billing_date"],
    a["phone"],
    p["phone"],
    a["expire_date"],
    p["expire_date"],
    a["exp_date"],
    p["exp_date"],
  ];

  for (const c of candidates) {
    if (!isReal(c)) continue;
    const raw = String(c).trim();

    const tsEpoch = expiryTsFromEpoch(raw);
    if (tsEpoch !== null) {
      return { expiryDate: formatEpoch(raw), expiryTs: tsEpoch };
    }

    const tsMysql = expiryTsFromMysqlDateTime(raw);
    if (tsMysql !== null) {
      return { expiryDate: formatMysqlDateTime(raw), expiryTs: tsMysql };
    }

    // Unknown format: keep display value; sorting will fall back to client parsing.
    return { expiryDate: raw };
  }

  return { expiryDate: "N/A" };
}

function pickChannelCount(payload: unknown): string | null {
  const js = asObj(payload)["js"];
  if (Array.isArray(js)) return String(js.length);

  const jsObj = asObj(js);
  const data = jsObj["data"];
  if (Array.isArray(data)) {
    // Some portals also provide total_items; prefer it when valid.
    const totalItems = jsObj["total_items"];
    if (isReal(totalItems)) {
      const n = Number(String(totalItems));
      if (Number.isFinite(n) && n >= 0) return String(n);
    }
    return String(data.length);
  }

  const totalItems = jsObj["total_items"];
  if (isReal(totalItems)) {
    const n = Number(String(totalItems));
    if (Number.isFinite(n) && n >= 0) return String(n);
  }

  return null;
}

function pickMaxOnline(jsAccount: unknown, jsProfile: unknown): string {
  const a = asObj(jsAccount);
  const p = asObj(jsProfile);
  const storages = a["storages"] ?? p["storages"];
  if (storages && typeof storages === "object") {
    const nums: number[] = [];
    for (const key of Object.keys(storages)) {
      const v = asObj(asObj(storages)[key])["max_online"];
      if (isReal(v)) {
        const n = Number(String(v));
        if (Number.isFinite(n)) nums.push(n);
      }
    }
    if (nums.length > 0) return String(Math.max(...nums));
  }

  const v = a["max_online"] ?? p["max_online"];
  if (isReal(v)) return String(v);
  return "N/A";
}

async function tryPortalPhp(baseUrl: string, mac: string) {
  // Most Stalker portals expose `portal.php`. We do a handshake to get a token,
  // then call profile + account endpoints using MAG-like headers/cookies.
  const handshakeUrl = `${baseUrl}/portal.php?type=stb&action=handshake&JsHttpRequest=1-xml`;
  const cookies = {
    mac,
    stb_lang: "en",
    timezone: "Europe/London",
  };

  const res = await fetchWithTimeout(handshakeUrl, {
    method: "GET",
    headers: {
      "User-Agent": "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3",
      Cookie: Object.entries(cookies)
        .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
        .join("; "),
    },
    timeoutMs: 15000,
  });

  if (!res.ok) throw new Error(`Handshake failed (HTTP ${res.status}).`);
  const j = await safeJson(res);
  const token = asObj(asObj(j)["js"])["token"];
  if (!isReal(token)) throw new Error("Handshake did not return a token.");

  const authedCookies = {
    ...cookies,
    token: String(token),
  };

  const headers = {
    "User-Agent": "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3",
    Authorization: `Bearer ${token}`,
    Cookie: Object.entries(authedCookies)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join("; "),
  };

  const profileUrl = `${baseUrl}/portal.php?type=stb&action=get_profile&JsHttpRequest=1-xml`;
  const accountUrl = `${baseUrl}/portal.php?type=account_info&action=get_main_info&JsHttpRequest=1-xml`;

  const [profileRes, accountRes] = await Promise.all([
    fetchWithTimeout(profileUrl, { headers, timeoutMs: 15000 }),
    fetchWithTimeout(accountUrl, { headers, timeoutMs: 15000 }),
  ]);

  const profileJson = profileRes.ok ? await safeJson(profileRes) : {};
  const accountJson = accountRes.ok ? await safeJson(accountRes) : {};

  return {
    timezoneUsed: "Europe/London",
    token: String(token),
    cookies: authedCookies,
    headers,
    profileJson,
    accountJson,
  };
}

async function tryStalkerPortalLoadPhp(baseUrl: string, mac: string) {
  // Compatibility mode for portals using /stalker_portal/server/load.php
  const handshakeUrl = `${baseUrl}/stalker_portal/server/load.php?type=stb&action=handshake&token=&JsHttpRequest=1-xml`;
  const cookies = {
    mac,
    stb_lang: "en",
    timezone: "Europe/London",
  };

  const res = await fetchWithTimeout(handshakeUrl, {
    method: "GET",
    headers: {
      "User-Agent": "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3",
      Referer: `${baseUrl}/stalker_portal/c/index.html`,
      Cookie: Object.entries(cookies)
        .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
        .join("; "),
    },
    timeoutMs: 15000,
  });

  if (!res.ok) throw new Error(`Handshake failed (HTTP ${res.status}).`);
  const j = await safeJson(res);
  const token = asObj(asObj(j)["js"])["token"];
  if (!isReal(token)) throw new Error("Handshake did not return a token.");

  const authedCookies = { ...cookies, token: String(token) };

  const headers = {
    "User-Agent": "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3",
    "X-User-Agent": "Model: MAG250; Link: WiFi",
    Authorization: `Bearer ${token}`,
    Referer: `${baseUrl}/stalker_portal/c/index.html`,
    Cookie: Object.entries(authedCookies)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join("; "),
  };

  const profileUrl = `${baseUrl}/stalker_portal/server/load.php?type=stb&action=get_profile&hd=1&JsHttpRequest=1-xml`;
  const accountUrl = `${baseUrl}/stalker_portal/server/load.php?type=account_info&action=get_main_info&JsHttpRequest=1-xml`;

  const [profileRes, accountRes] = await Promise.all([
    fetchWithTimeout(profileUrl, { headers, timeoutMs: 15000 }),
    fetchWithTimeout(accountUrl, { headers, timeoutMs: 15000 }),
  ]);

  const profileJson = profileRes.ok ? await safeJson(profileRes) : {};
  const accountJson = accountRes.ok ? await safeJson(accountRes) : {};

  return {
    timezoneUsed: "Europe/London",
    token: String(token),
    cookies: authedCookies,
    headers,
    profileJson,
    accountJson,
  };
}

export async function POST(req: Request) {
  const requestId = crypto.randomUUID();
  try {
    const blocked = requireClient(req);
    if (blocked) return blocked;

    const ct = (req.headers.get("content-type") || "").toLowerCase();
    if (!ct.includes("application/json")) {
      return NextResponse.json({ requestId, ok: false, error: "Unsupported content type." }, { status: 415, headers: NO_STORE_HEADERS });
    }

    // NOTE: This endpoint is intentionally defensive:
    // - normalizes URL/MAC
    // - tries both portal.php and stalker_portal/server/load.php styles
    // - uses timeouts to avoid hanging serverless lambdas
    const body = await req.json();
    const rawUrl = typeof body?.url === "string" ? body.url : String(body?.url ?? "");
    const rawMac = typeof body?.mac === "string" ? body.mac : String(body?.mac ?? "");

    if (rawUrl.length > 2048 || rawMac.length > 64) {
      return NextResponse.json({ requestId, ok: false, error: "Input too large." }, { status: 413, headers: NO_STORE_HEADERS });
    }

    const portalBase = normalizeStalkerUrl(rawUrl);
    const origin = new URL(portalBase).origin;
    const mac = normalizeMac(rawMac);

    let profileJson: unknown = {};
    let accountJson: unknown = {};
    let timezone = "Europe/London";
    let token = "";
    let cookiesForFollowups: Record<string, string> | null = null;
    let headersForFollowups: Record<string, string> | null = null;

    // Try portal.php first (common)
    try {
      const r = await tryPortalPhp(portalBase, mac);
      profileJson = r.profileJson;
      accountJson = r.accountJson;
      timezone = r.timezoneUsed;
      token = r.token;
      cookiesForFollowups = r.cookies;
      headersForFollowups = r.headers;
    } catch {
      // Fallback to stalker_portal/server/load.php
      const r = await tryStalkerPortalLoadPhp(origin, mac);
      profileJson = r.profileJson;
      accountJson = r.accountJson;
      timezone = r.timezoneUsed;
      token = r.token;
      cookiesForFollowups = r.cookies;
      headersForFollowups = r.headers;
    }

    const jsProfile = asObj(profileJson)["js"];
    const jsAccount = asObj(accountJson)["js"];

    const expiry = pickExpiryInfo(jsAccount, jsProfile);
    const expiryDate = expiry.expiryDate;
    const maxConnections = pickMaxOnline(jsAccount, jsProfile);

    // You asked for PORTAL URL as REAL URL
    const realUrl = portalBase;
    const port = parsePortFromOrigin(portalBase);

    // Portal IP (MacAttack uses DNS resolution)
    let portalIp: string = "N/A";
    try {
      const host = new URL(portalBase).hostname;
      const r = await lookup(host);
      portalIp = r.address || "N/A";
    } catch {
      // ignore
    }

    // Channels count (MacAttack uses type=itv&action=get_all_channels)
    let channels: string = "N/A";
    try {
      if (token && headersForFollowups && cookiesForFollowups) {
        const cookieHeader = Object.entries(cookiesForFollowups)
          .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
          .join("; ");

        const tryUrls = [
          `${portalBase}/portal.php?type=itv&action=get_all_channels&JsHttpRequest=1-xml`,
          `${origin}/stalker_portal/server/load.php?type=itv&action=get_all_channels&JsHttpRequest=1-xml`,
        ];

        for (const u of tryUrls) {
          const resAll = await fetchWithTimeout(u, {
            headers: {
              ...headersForFollowups,
              Cookie: cookieHeader,
            },
            timeoutMs: 15000,
          });

          if (resAll.ok) {
            const jAll = await safeJson(resAll);
            const count = pickChannelCount(jAll);
            if (count !== null) {
              channels = count;
              break;
            }
          }
        }
      }
    } catch {
      // ignore
    }

    return NextResponse.json(
      {
        requestId,
        ok: true,
        expiryDate,
        expiryTs: typeof expiry.expiryTs === "number" ? expiry.expiryTs : undefined,
        maxConnections,
        realUrl,
        port,
        timezone,
        portalIp,
        channels,
      },
      { headers: NO_STORE_HEADERS }
    );
  } catch (e: unknown) {
    const msg =
      typeof e === "object" && e !== null && "name" in e && (e as { name?: unknown }).name === "AbortError"
        ? "Request timed out. Try again."
        : e instanceof Error
          ? e.message
          : "Unknown error.";
    return NextResponse.json({ requestId, ok: false, error: msg }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
