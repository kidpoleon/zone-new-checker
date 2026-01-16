import { NextResponse } from "next/server";
import { fetchWithTimeout, safeJson } from "@/lib/http";
import { normalizeMac, normalizeStalkerUrl } from "@/lib/validation";
import { createInMemoryRateLimiter, getClientIp, RATE_MAX_PLAYLIST_PER_WINDOW, RATE_WINDOW_MS } from "@/lib/rateLimit";
import { isHumanVerified } from "@/lib/humanVerification";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
} as const;

const rateLimiter = createInMemoryRateLimiter(RATE_WINDOW_MS, RATE_MAX_PLAYLIST_PER_WINDOW);

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

function isReal(v: unknown): boolean {
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

type StalkerGenrePayload = {
  id?: unknown;
  title?: unknown;
  name?: unknown;
};

type StalkerChannelPayload = {
  id?: unknown;
  ch_id?: unknown;
  name?: unknown;
  title?: unknown;
  logo?: unknown;
  logo_64?: unknown;
  logo_128?: unknown;
  screenshot_uri?: unknown;
  tv_genre_logo?: unknown;
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

  return { baseUrl, headers };
}

function pickLogo(item: unknown): string {
  // Different portal builds use different logo fields; we scan common candidates.
  const o = asObj(item) as StalkerChannelPayload;
  const candidates = [o.logo, o.logo_64, o.logo_128, o.screenshot_uri, o.tv_genre_logo];
  for (const c of candidates) {
    if (isReal(c)) return String(c).trim();
  }
  return "";
}

async function readJsonBody(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new Error("Invalid JSON body.");
  }
}

export async function POST(req: Request) {
  const requestId = crypto.randomUUID();
  try {
    const blocked = requireClient(req);
    if (blocked) return blocked;

    if (!(await isHumanVerified(req, Date.now()))) {
      return NextResponse.json(
        { requestId, ok: false, error: "Human verification required.", code: "human_verification_required" },
        { status: 403, headers: NO_STORE_HEADERS }
      );
    }

    const ip = getClientIp(req);
    if (!rateLimiter.allow(ip)) {
      return NextResponse.json({ requestId, ok: false, error: "Too many requests." }, { status: 429, headers: NO_STORE_HEADERS });
    }

    const ct = (req.headers.get("content-type") || "").toLowerCase();
    if (!ct.includes("application/json")) {
      return NextResponse.json({ requestId, ok: false, error: "Unsupported content type." }, { status: 415, headers: NO_STORE_HEADERS });
    }

    const body = await readJsonBody(req);
    const b = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
    const rawUrl = typeof b["url"] === "string" ? String(b["url"]) : String(b["url"] ?? "");
    const rawMac = typeof b["mac"] === "string" ? String(b["mac"]) : String(b["mac"] ?? "");

    if (rawUrl.length > 2048 || rawMac.length > 64) {
      return NextResponse.json({ requestId, ok: false, error: "Input too large." }, { status: 413, headers: NO_STORE_HEADERS });
    }

    let portalBase = "";
    let origin = "";
    let mac = "";
    let genreId = "";
    let page = 0;
    let all = false;
    try {
      portalBase = normalizeStalkerUrl(rawUrl);
      origin = new URL(portalBase).origin;
      mac = normalizeMac(rawMac);
      genreId = normalizeGenreId(b["genreId"]);
      page = normalizePage(b["page"]);
      all = Boolean(b["all"]);
    } catch (e: unknown) {
      return NextResponse.json(
        { requestId, ok: false, error: e instanceof Error ? e.message : "Invalid input." },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }

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

    let genresPayload: unknown = null;
    for (const u of genreUrls) {
      const res = await fetchWithTimeout(u, { headers, timeoutMs: 20000 });
      if (res.ok) {
        genresPayload = await safeJson(res);
        break;
      }
    }

    const jsGenres = asObj(genresPayload)["js"];
    const genres: StalkerGenre[] = Array.isArray(jsGenres)
      ? jsGenres
          .map((g: unknown) => {
            const gg = asObj(g) as StalkerGenrePayload;
            const id = isReal(gg.id) ? String(gg.id).trim() : "";
            const name = isReal(gg.title) ? String(gg.title).trim() : isReal(gg.name) ? String(gg.name).trim() : "";
            return { id, name };
          })
          .filter((g: StalkerGenre) => g.id && g.name)
      : [];

    let channels: StalkerChannel[] = [];
    let hasMore = false;
    let pageOut = page;
    if (genreId) {
      const MAX_PAGES = 200;
      const MAX_CHANNELS = 15000;
      const CONCURRENCY = 6;

      const fetchPage = async (p: number): Promise<{ chans: StalkerChannel[]; hasMore: boolean; totalItems?: number; perPage?: number }> => {
        const listUrls = [
          `${portalBase}/portal.php?type=itv&action=get_ordered_list&genre=${encodeURIComponent(genreId)}&p=${p}&JsHttpRequest=1-xml`,
          `${origin}/stalker_portal/server/load.php?type=itv&action=get_ordered_list&genre=${encodeURIComponent(genreId)}&p=${p}&JsHttpRequest=1-xml`,
        ];

        let listPayload: unknown = null;
        for (const u of listUrls) {
          const res = await fetchWithTimeout(u, { headers, timeoutMs: 25000 });
          if (res.ok) {
            listPayload = await safeJson(res);
            break;
          }
        }

        const js = asObj(listPayload)["js"];
        const jsObj = asObj(js);
        const data = Array.isArray(jsObj["data"]) ? (jsObj["data"] as unknown[]) : Array.isArray(js) ? (js as unknown[]) : null;

        let out: StalkerChannel[] = [];
        if (Array.isArray(data)) {
          out = data
            .map((c: unknown) => {
              const cc = asObj(c) as StalkerChannelPayload;
              const id = isReal(cc.id) ? String(cc.id).trim() : isReal(cc.ch_id) ? String(cc.ch_id).trim() : "";
              const name = isReal(cc.name) ? String(cc.name).trim() : isReal(cc.title) ? String(cc.title).trim() : "";
              const logoRaw = pickLogo(c);
              const logo = logoRaw ? absolutizeMaybe(portalBase, logoRaw) : "";
              const ch: StalkerChannel = { id, name };
              if (logo) ch.logo = logo;
              return ch;
            })
            .filter((x: StalkerChannel) => x.id && x.name);
        }

        const totalItemsRaw = jsObj["total_items"];
        const perPageRaw = jsObj["max_page_items"];
        const totalItems = isReal(totalItemsRaw) ? Number(String(totalItemsRaw)) : NaN;
        const perPage = isReal(perPageRaw) ? Number(String(perPageRaw)) : out.length;

        let more = false;
        if (Number.isFinite(totalItems) && totalItems >= 0 && Number.isFinite(perPage) && perPage > 0) {
          const loaded = p * perPage + out.length;
          more = loaded < totalItems;
        } else {
          more = out.length > 0;
        }

        return {
          chans: out,
          hasMore: more,
          totalItems: Number.isFinite(totalItems) ? totalItems : undefined,
          perPage: Number.isFinite(perPage) ? perPage : undefined,
        };
      };

      async function runPool<T>(items: T[], concurrency: number, worker: (item: T, idx: number) => Promise<void>) {
        const pool = new Set<Promise<void>>();
        for (let i = 0; i < items.length; i++) {
          const p = worker(items[i], i)
            .catch(() => {
              // worker handles errors
            })
            .finally(() => {
              pool.delete(p);
            });
          pool.add(p);
          if (pool.size >= concurrency) {
            await Promise.race(pool);
          }
        }
        await Promise.all(pool);
      }

      if (all) {
        const allChans: StalkerChannel[] = [];
        const seen = new Set<string>();

        const add = (list: StalkerChannel[]) => {
          for (const ch of list) {
            if (seen.has(ch.id)) continue;
            seen.add(ch.id);
            allChans.push(ch);
            if (allChans.length >= MAX_CHANNELS) break;
          }
        };

        // Always fetch page 0 first to discover totals/per-page if available.
        const first = await fetchPage(0);
        if (first.chans.length === 0) {
          channels = [];
          hasMore = false;
          pageOut = 0;
        } else {
          add(first.chans);

          const totalItems = typeof first.totalItems === "number" ? first.totalItems : undefined;
          const perPage = typeof first.perPage === "number" ? first.perPage : undefined;
          const canPlan = typeof totalItems === "number" && typeof perPage === "number" && perPage > 0 && totalItems >= 0;
          const plannedPages = canPlan ? Math.min(MAX_PAGES, Math.ceil(totalItems / perPage)) : 0;

          if (plannedPages > 1) {
            const pages = Array.from({ length: plannedPages - 1 }, (_, i) => i + 1);
            await runPool(pages, CONCURRENCY, async (p) => {
              if (allChans.length >= MAX_CHANNELS) return;
              const r = await fetchPage(p);
              if (r.chans.length === 0) return;
              add(r.chans);
            });
          } else if (first.hasMore) {
            // Fallback when totals are missing or unreliable: sequential until empty.
            for (let p = 1; p < MAX_PAGES; p++) {
              if (allChans.length >= MAX_CHANNELS) break;
              const r = await fetchPage(p);
              if (r.chans.length === 0) break;
              add(r.chans);
              if (!r.hasMore) break;
            }
          }

          channels = allChans;
          hasMore = false;
          pageOut = 0;
        }
      } else {
        const r = await fetchPage(page);
        channels = r.chans;
        hasMore = r.hasMore;
        pageOut = page;
      }
    }

    return NextResponse.json(
      {
        requestId,
        ok: true,
        realUrl: baseUrlUsed,
        genres,
        channels,
        page: pageOut,
        hasMore,
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
