import { NextResponse } from "next/server";
import { fetchWithTimeout, safeJson } from "@/lib/http";
import { normalizeUrl, parsePortFromOrigin } from "@/lib/validation";

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
    // Validate credentials via player_api.php (Xtream Codes API).
    // We keep strict timeouts to avoid long-running serverless executions.
    const body = await req.json();
    const url = normalizeUrl(body?.url);
    const username = String(body?.username || "").trim();
    const password = String(body?.password || "").trim();

    if (!username) {
      return NextResponse.json({ requestId, ok: false, error: "Username is required." }, { status: 400 });
    }
    if (!password) {
      return NextResponse.json({ requestId, ok: false, error: "Password is required." }, { status: 400 });
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
        { status: 502 }
      );
    }

    const json = await safeJson(res);
    const userInfo = json?.user_info;
    const serverInfo = json?.server_info;

    if (!userInfo || typeof userInfo !== "object") {
      const msg = typeof json?.message === "string" ? json.message : "Invalid credentials or unsupported server.";
      return NextResponse.json({ requestId, ok: false, error: msg }, { status: 401 });
    }

    const expiryDate = formatExpiry(userInfo?.exp_date);
    const maxConnections = String(userInfo?.max_connections ?? "N/A");

    const serverUrl = String(serverInfo?.url ?? "").trim();
    const serverPort = String(serverInfo?.port ?? "").trim();
    const timezone = String(serverInfo?.timezone ?? "N/A");

    const realUrl = serverUrl ? serverUrl : url.replace(/^https?:\/\//i, "");
    const port = serverPort ? serverPort : parsePortFromOrigin(url);

    return NextResponse.json({
      requestId,
      ok: true,
      expiryDate,
      maxConnections,
      realUrl,
      port,
      timezone,
    });
  } catch (e: any) {
    const msg = e?.name === "AbortError" ? "Request timed out. Try again." : (e?.message || "Unknown error.");
    return NextResponse.json({ requestId, ok: false, error: msg }, { status: 500 });
  }
}
