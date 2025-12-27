import { NextResponse } from "next/server";
import { fetchWithTimeout, safeJson } from "@/lib/http";
import { normalizeUrl } from "@/lib/validation";

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

type XtreamCategory = { id: string; name: string };

type XtreamChannel = {
  id: string;
  name: string;
  logo?: string;
  categoryId?: string;
};

export async function POST(req: Request) {
  const requestId = crypto.randomUUID();
  try {
    // Single endpoint that returns:
    // - categories (always)
    // - channels (only when categoryId is provided)
    // This keeps the UI logic simple while keeping API calls minimal.
    const body = await req.json();
    const url = normalizeUrl(body?.url);
    const username = String(body?.username || "").trim();
    const password = String(body?.password || "").trim();
    const categoryId = normalizeCategoryId(body?.categoryId);

    if (!username) return NextResponse.json({ requestId, ok: false, error: "Username is required." }, { status: 400 });
    if (!password) return NextResponse.json({ requestId, ok: false, error: "Password is required." }, { status: 400 });

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
        { status: 502 }
      );
    }

    const categoriesJson = await safeJson(categoriesRes);
    if (!Array.isArray(categoriesJson)) {
      const msg = typeof categoriesJson?.message === "string" ? categoriesJson.message : "Invalid credentials or unsupported server.";
      return NextResponse.json({ requestId, ok: false, error: msg }, { status: 401 });
    }

    const categories: XtreamCategory[] = categoriesJson
      .map((c: any) => {
        const id = typeof c?.category_id === "string" || typeof c?.category_id === "number" ? String(c.category_id) : "";
        const name = typeof c?.category_name === "string" ? c.category_name : "";
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
          { status: 502 }
        );
      }

      const streamsJson = await safeJson(streamsRes);
      if (Array.isArray(streamsJson)) {
        channels = streamsJson
          .map((s: any) => {
            const id = typeof s?.stream_id === "string" || typeof s?.stream_id === "number" ? String(s.stream_id).trim() : "";
            const name = typeof s?.name === "string" ? s.name.trim() : "";
            const logoRaw = typeof s?.stream_icon === "string" ? s.stream_icon.trim() : "";
            const logo = logoRaw ? absolutizeMaybe(url, logoRaw) : "";
            const cat = typeof s?.category_id === "string" || typeof s?.category_id === "number" ? String(s.category_id).trim() : "";
            const out: XtreamChannel = { id, name };
            if (logo) out.logo = logo;
            if (cat) out.categoryId = cat;
            return out;
          })
          .filter((x: XtreamChannel) => x.id && x.name);
      }
    }

    return NextResponse.json({
      requestId,
      ok: true,
      categories,
      channels,
    });
  } catch (e: any) {
    const msg = e?.name === "AbortError" ? "Request timed out. Try again." : (e?.message || "Unknown error.");
    return NextResponse.json({ requestId, ok: false, error: msg }, { status: 500 });
  }
}
