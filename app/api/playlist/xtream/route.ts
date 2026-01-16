import { NextResponse } from "next/server";
import { fetchWithTimeout, safeJson } from "@/lib/http";
import { normalizeUrl } from "@/lib/validation";
import { createInMemoryRateLimiter, getClientIp, RATE_MAX_PLAYLIST_PER_WINDOW, RATE_WINDOW_MS } from "@/lib/rateLimit";

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

function absolutizeMaybe(urlOrigin: string, maybeUrl: string): string {
  // Xtream often returns relative logo URLs. We convert them to absolute URLs
  // so the frontend can proxy them consistently via /api/image.
  const raw = (maybeUrl || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith("//")) {
    try {
      const origin = new URL(urlOrigin);
      return `${origin.protocol}${raw}`;
    } catch {
      return raw;
    }
  }
  try {
    return new URL(raw, urlOrigin).toString();
  } catch {
    return raw;
  }
}

function normalizeCategoryId(v: unknown): string {
  const s = typeof v === "string" || typeof v === "number" ? String(v).trim() : "";
  if (!s) return "";
  if (!/^[0-9]+$/.test(s)) throw new Error("Invalid category id.");
  return s;
}

async function readJsonBody(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new Error("Invalid JSON body.");
  }
}

type XtreamCategory = { id: string; name: string };

type XtreamChannel = {
  id: string;
  name: string;
  logo?: string;
  categoryId?: string;
};

type XtreamCategoryPayload = {
  category_id?: unknown;
  category_name?: unknown;
};

type XtreamStreamPayload = {
  stream_id?: unknown;
  name?: unknown;
  stream_icon?: unknown;
  category_id?: unknown;
};

export async function POST(req: Request) {
  const requestId = crypto.randomUUID();
  try {
    const blocked = requireClient(req);
    if (blocked) return blocked;

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
    const rawUser = typeof b["username"] === "string" ? String(b["username"]) : String(b["username"] ?? "");
    const rawPass = typeof b["password"] === "string" ? String(b["password"]) : String(b["password"] ?? "");

    if (rawUrl.length > 2048 || rawUser.length > 256 || rawPass.length > 256) {
      return NextResponse.json({ requestId, ok: false, error: "Input too large." }, { status: 413, headers: NO_STORE_HEADERS });
    }

    let url = "";
    let username = "";
    let password = "";
    let categoryId = "";
    try {
      url = normalizeUrl(rawUrl);
      username = rawUser.trim();
      password = rawPass.trim();
      categoryId = normalizeCategoryId(b["categoryId"]);
    } catch (e: unknown) {
      return NextResponse.json(
        { requestId, ok: false, error: e instanceof Error ? e.message : "Invalid input." },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }

    if (!username) return NextResponse.json({ requestId, ok: false, error: "Username is required." }, { status: 400, headers: NO_STORE_HEADERS });
    if (!password) return NextResponse.json({ requestId, ok: false, error: "Password is required." }, { status: 400, headers: NO_STORE_HEADERS });

    const apiUrl = `${url}/player_api.php`;

    const categoriesForm = new URLSearchParams({
      username,
      password,
      action: "get_live_categories",
    });

    const categoriesRes = await fetchWithTimeout(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "IPTVChecker/1.0",
      },
      body: categoriesForm.toString(),
      timeoutMs: 20000,
    });

    if (!categoriesRes.ok) {
      return NextResponse.json(
        {
          requestId,
          ok: false,
          error:
            categoriesRes.status === 404
              ? "Xtream endpoint not found (HTTP 404). This server may not expose player_api.php, or the URL is wrong."
              : `Xtream server error (HTTP ${categoriesRes.status}). Check URL and credentials.`,
        },
        { status: 502, headers: NO_STORE_HEADERS }
      );
    }

    const categoriesJson = await safeJson(categoriesRes);
    if (!Array.isArray(categoriesJson)) {
      const msg = typeof asObj(categoriesJson)["message"] === "string" ? String(asObj(categoriesJson)["message"]) : "Invalid credentials or unsupported server.";
      return NextResponse.json({ requestId, ok: false, error: msg }, { status: 401, headers: NO_STORE_HEADERS });
    }

    const categories: XtreamCategory[] = categoriesJson
      .map((c: unknown) => {
        const o = asObj(c) as XtreamCategoryPayload;
        const id = typeof o.category_id === "string" || typeof o.category_id === "number" ? String(o.category_id) : "";
        const name = typeof o.category_name === "string" ? o.category_name : "";
        return { id: id.trim(), name: name.trim() };
      })
      .filter((c: XtreamCategory) => c.id && c.name);

    let channels: XtreamChannel[] = [];
    if (categoryId) {
      const streamsForm = new URLSearchParams({
        username,
        password,
        action: "get_live_streams",
        category_id: categoryId,
      });

      const streamsRes = await fetchWithTimeout(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "IPTVChecker/1.0",
        },
        body: streamsForm.toString(),
        timeoutMs: 25000,
      });

      if (!streamsRes.ok) {
        return NextResponse.json(
          { requestId, ok: false, error: `Failed to load channels (HTTP ${streamsRes.status}).` },
          { status: 502, headers: NO_STORE_HEADERS }
        );
      }

      const streamsJson = await safeJson(streamsRes);
      if (Array.isArray(streamsJson)) {
        channels = streamsJson
          .map((s: unknown) => {
            const o = asObj(s) as XtreamStreamPayload;
            const id = typeof o.stream_id === "string" || typeof o.stream_id === "number" ? String(o.stream_id).trim() : "";
            const name = typeof o.name === "string" ? o.name.trim() : "";
            const logoRaw = typeof o.stream_icon === "string" ? o.stream_icon.trim() : "";
            const logo = logoRaw ? absolutizeMaybe(url, logoRaw) : "";
            const cat = typeof o.category_id === "string" || typeof o.category_id === "number" ? String(o.category_id).trim() : "";
            const out: XtreamChannel = { id, name };
            if (logo) out.logo = logo;
            if (cat) out.categoryId = cat;
            return out;
          })
          .filter((x: XtreamChannel) => x.id && x.name);
      }
    }

    return NextResponse.json(
      {
        requestId,
        ok: true,
        categories,
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
