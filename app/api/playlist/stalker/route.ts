import { NextResponse } from "next/server";
import { fetchWithTimeout, safeJson } from "@/lib/http";
import { normalizeMac, normalizeStalkerUrl } from "@/lib/validation";

function absolutizeMaybe(base: string, maybeUrl: string): string {
  // Stalker returns logos as absolute, protocol-relative, or relative paths.
  // We normalize them so the frontend can proxy them reliably.
  const raw = (maybeUrl || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith("//")) {
    try {
      const u = new URL(base);
      return `${u.protocol}${raw}`;
    } catch {
      return raw;
    }
  }
  try {
    return new URL(raw, base).toString();
  } catch {
    return raw;
  }
}

function isReal(v: any): boolean {
  if (v === null || v === undefined) return false;
  const s = String(v).trim();
  if (!s) return false;
  if (s === "0" || s.toLowerCase() === "null" || s.toLowerCase() === "none") return false;
  if (s === "0000-00-00 00:00:00") return false;
  return true;
}

function normalizeGenreId(v: unknown): string {
  const s = typeof v === "string" || typeof v === "number" ? String(v).trim() : "";
  if (!s) return "";
  if (!/^[0-9]+$/.test(s)) throw new Error("Invalid genre id.");
  return s;
}

function normalizePage(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(String(v));
  if (!Number.isFinite(n) || n < 0) throw new Error("Invalid page.");
  return Math.floor(n);
}

type StalkerGenre = { id: string; name: string };

type StalkerChannel = {
  id: string;
  name: string;
  logo?: string;
};

async function tryPortalPhp(baseUrl: string, mac: string) {
  // Authenticate via portal.php handshake and return headers for follow-up calls.
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
  const token = j?.js?.token;
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

  return { baseUrl, headers };
}

async function tryStalkerPortalLoadPhp(origin: string, mac: string) {
  // Some portals only expose the Stalker API under /stalker_portal/server/load.php.
  // This function performs a compatible handshake and returns usable headers.
  const baseUrl = origin;
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
  const token = j?.js?.token;
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

  return { baseUrl, headers };
}

function pickLogo(item: any): string {
  // Different portal builds use different logo fields; we scan common candidates.
  const candidates = [item?.logo, item?.logo_64, item?.logo_128, item?.screenshot_uri, item?.tv_genre_logo];
  for (const c of candidates) {
    if (isReal(c)) return String(c).trim();
  }
  return "";
}

export async function POST(req: Request) {
  const requestId = crypto.randomUUID();
  try {
    // Returns:
    // - genres (always)
    // - channels (only when genreId is provided)
    // Channels are paginated because Stalker portals can have very large lists.
    const body = await req.json();
    const portalBase = normalizeStalkerUrl(body?.url);
    const origin = new URL(portalBase).origin;
    const mac = normalizeMac(body?.mac);
    const genreId = normalizeGenreId(body?.genreId);
    const page = normalizePage(body?.page);

    let headers: Record<string, string> | null = null;
    let baseUrlUsed: string = portalBase;

    try {
      const r = await tryPortalPhp(portalBase, mac);
      headers = r.headers;
      baseUrlUsed = r.baseUrl;
    } catch {
      const r = await tryStalkerPortalLoadPhp(origin, mac);
      headers = r.headers;
      baseUrlUsed = r.baseUrl;
    }

    if (!headers) throw new Error("Failed to authenticate to portal.");

    const genreUrls = [
      `${portalBase}/portal.php?type=itv&action=get_genres&JsHttpRequest=1-xml`,
      `${origin}/stalker_portal/server/load.php?type=itv&action=get_genres&JsHttpRequest=1-xml`,
    ];

    let genresPayload: any = null;
    for (const u of genreUrls) {
      const res = await fetchWithTimeout(u, { headers, timeoutMs: 20000 });
      if (res.ok) {
        genresPayload = await safeJson(res);
        break;
      }
    }

    const jsGenres = genresPayload?.js;
    const genres: StalkerGenre[] = Array.isArray(jsGenres)
      ? jsGenres
          .map((g: any) => {
            const id = isReal(g?.id) ? String(g.id).trim() : "";
            const name = isReal(g?.title) ? String(g.title).trim() : isReal(g?.name) ? String(g.name).trim() : "";
            return { id, name };
          })
          .filter((g: StalkerGenre) => g.id && g.name)
      : [];

    let channels: StalkerChannel[] = [];
    let hasMore = false;
    if (genreId) {
      const listUrls = [
        `${portalBase}/portal.php?type=itv&action=get_ordered_list&genre=${encodeURIComponent(genreId)}&p=${page}&JsHttpRequest=1-xml`,
        `${origin}/stalker_portal/server/load.php?type=itv&action=get_ordered_list&genre=${encodeURIComponent(genreId)}&p=${page}&JsHttpRequest=1-xml`,
      ];

      let listPayload: any = null;
      for (const u of listUrls) {
        const res = await fetchWithTimeout(u, { headers, timeoutMs: 25000 });
        if (res.ok) {
          listPayload = await safeJson(res);
          break;
        }
      }

      const js = listPayload?.js;
      const data = Array.isArray(js?.data) ? js.data : Array.isArray(js) ? js : null;
      if (Array.isArray(data)) {
        channels = data
          .map((c: any) => {
            const id = isReal(c?.id) ? String(c.id).trim() : isReal(c?.ch_id) ? String(c.ch_id).trim() : "";
            const name = isReal(c?.name) ? String(c.name).trim() : isReal(c?.title) ? String(c.title).trim() : "";
            const logoRaw = pickLogo(c);
            const logo = logoRaw ? absolutizeMaybe(portalBase, logoRaw) : "";
            const out: StalkerChannel = { id, name };
            if (logo) out.logo = logo;
            return out;
          })
          .filter((x: StalkerChannel) => x.id && x.name);

        const totalItemsRaw = js?.total_items;
        const perPageRaw = js?.max_page_items;
        const totalItems = isReal(totalItemsRaw) ? Number(String(totalItemsRaw)) : NaN;
        const perPage = isReal(perPageRaw) ? Number(String(perPageRaw)) : channels.length;
        if (Number.isFinite(totalItems) && totalItems >= 0 && Number.isFinite(perPage) && perPage > 0) {
          const loaded = page * perPage + channels.length;
          hasMore = loaded < totalItems;
        } else {
          // If the portal doesn't expose totals, treat a full page as possibly having more.
          hasMore = channels.length > 0;
        }
      }
    }

    return NextResponse.json({
      requestId,
      ok: true,
      realUrl: baseUrlUsed,
      genres,
      channels,
      page,
      hasMore,
    });
  } catch (e: any) {
    const msg = e?.name === "AbortError" ? "Request timed out. Try again." : (e?.message || "Unknown error.");
    return NextResponse.json({ requestId, ok: false, error: msg }, { status: 500 });
  }
}
