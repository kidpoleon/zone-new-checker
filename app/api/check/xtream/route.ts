import { NextResponse } from "next/server";
import { fetchWithTimeout, safeJson } from "@/lib/http";
import { normalizeUrl, parsePortFromOrigin } from "@/lib/validation";
import { createInMemoryRateLimiter, getClientIp, RATE_MAX_CHECK_PER_WINDOW, RATE_WINDOW_MS } from "@/lib/rateLimit";
import { isHumanVerified } from "@/lib/humanVerification";

export const maxDuration = 30;

const rateLimiter = createInMemoryRateLimiter(RATE_WINDOW_MS, RATE_MAX_CHECK_PER_WINDOW);

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
    const rawUser = typeof b["username"] === "string" ? String(b["username"]) : String(b["username"] ?? "");
    const rawPass = typeof b["password"] === "string" ? String(b["password"]) : String(b["password"] ?? "");

    if (rawUrl.length > 2048 || rawUser.length > 256 || rawPass.length > 256) {
      return NextResponse.json({ requestId, ok: false, error: "Input too large." }, { status: 413, headers: NO_STORE_HEADERS });
    }

    let url = "";
    let username = "";
    let password = "";
    try {
      url = normalizeUrl(rawUrl);
      username = rawUser.trim();
      password = rawPass.trim();
    } catch (e: unknown) {
      return NextResponse.json(
        { requestId, ok: false, error: e instanceof Error ? e.message : "Invalid input." },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }

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
    const activeConnections = String(userInfo["active_cons"] ?? "N/A");

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
        activeConnections,
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
