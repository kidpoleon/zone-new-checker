import { NextResponse } from "next/server";
import { fetchWithTimeout, safeJson } from "@/lib/http";
import { normalizeUrl, parsePortFromOrigin } from "@/lib/validation";

export const maxDuration = 30;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
} as const;

function requireClient(req: Request): Response | null {
  // Lightweight anti-abuse gate. Not a security boundary by itself,
  // but blocks naive scripts that just replay the endpoint without your UI.
  const v = req.headers.get("x-zonenew-client");
  if (v !== "1") {
    return NextResponse.json({ ok: false, error: "Forbidden." }, { status: 403, headers: NO_STORE_HEADERS });
  }
  return null;
}

function asObj(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
}

function formatExpiry(exp: unknown): string {
  // Xtream typically returns expiry as epoch seconds (`exp_date`).
  // We normalize it to a stable YYYY-MM-DD string for UI display.
  const v = typeof exp === "string" || typeof exp === "number" ? String(exp).trim() : "";
  if (!v) return "No Expiry";
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return "No Expiry";
  const d = new Date(n * 1000);
  if (Number.isNaN(d.getTime())) return "No Expiry";
  // YYYY-MM-DD
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export async function POST(req: Request) {
  const requestId = crypto.randomUUID();
  try {
    const blocked = requireClient(req);
    if (blocked) return blocked;

    // Validate credentials via player_api.php (Xtream Codes API).
    // We keep strict timeouts to avoid long-running serverless executions.
    const body = await req.json();
    const rawUrl = typeof body?.url === "string" ? body.url : String(body?.url ?? "");
    const rawUser = typeof body?.username === "string" ? body.username : String(body?.username ?? "");
    const rawPass = typeof body?.password === "string" ? body.password : String(body?.password ?? "");

    if (rawUrl.length > 2048 || rawUser.length > 256 || rawPass.length > 256) {
      return NextResponse.json({ requestId, ok: false, error: "Input too large." }, { status: 413, headers: NO_STORE_HEADERS });
    }

    const url = normalizeUrl(rawUrl);
    const username = rawUser.trim();
    const password = rawPass.trim();

    if (!username) {
      return NextResponse.json({ requestId, ok: false, error: "Username is required." }, { status: 400, headers: NO_STORE_HEADERS });
    }
    if (!password) {
      return NextResponse.json({ requestId, ok: false, error: "Password is required." }, { status: 400, headers: NO_STORE_HEADERS });
    }

    const apiUrl = `${url}/player_api.php`;
    const form = new URLSearchParams({
      username,
      password,
      action: "get_user_info",
    });

    const res = await fetchWithTimeout(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "IPTVChecker/1.0",
      },
      body: form.toString(),
      timeoutMs: 20000,
    });

    if (!res.ok) {
      return NextResponse.json(
        {
          requestId,
          ok: false,
          error:
            res.status === 404
              ? "Xtream endpoint not found (HTTP 404). This server may not expose player_api.php, or the URL is wrong."
              : `Xtream server error (HTTP ${res.status}). Check URL and credentials.`,
        },
        { status: 502, headers: NO_STORE_HEADERS }
      );
    }

    const json = await safeJson(res);
    const jsonObj = asObj(json);
    const userInfo = asObj(jsonObj["user_info"]);
    const serverInfo = asObj(jsonObj["server_info"]);

    if (Object.keys(userInfo).length === 0) {
      const msg = typeof jsonObj["message"] === "string" ? String(jsonObj["message"]) : "Invalid credentials or unsupported server.";
      return NextResponse.json({ requestId, ok: false, error: msg }, { status: 401, headers: NO_STORE_HEADERS });
    }

    const expiryDate = formatExpiry(userInfo["exp_date"]);
    const maxConnections = String(userInfo["max_connections"] ?? "N/A");

    const serverUrl = String(serverInfo["url"] ?? "").trim();
    const serverPort = String(serverInfo["port"] ?? "").trim();
    const timezone = String(serverInfo["timezone"] ?? "N/A");

    const realUrl = serverUrl ? serverUrl : url.replace(/^https?:\/\//i, "");
    const port = serverPort ? serverPort : parsePortFromOrigin(url);

    return NextResponse.json(
      {
        requestId,
        ok: true,
        expiryDate,
        maxConnections,
        realUrl,
        port,
        timezone,
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
