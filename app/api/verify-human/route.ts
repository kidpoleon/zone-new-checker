import { NextResponse } from "next/server";
import { createInMemoryRateLimiter, getClientIp } from "@/lib/rateLimit";
import { createHumanCookieValue, HUMAN_COOKIE_MAX_AGE_SECONDS, HUMAN_COOKIE_NAME } from "@/lib/humanVerification";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
} as const;

const verifyRateLimiter = createInMemoryRateLimiter(60_000, 20);

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

    const ip = getClientIp(req);
    if (!verifyRateLimiter.allow(ip)) {
      return NextResponse.json({ requestId, ok: false, error: "Too many requests." }, { status: 429, headers: NO_STORE_HEADERS });
    }

    const ct = (req.headers.get("content-type") || "").toLowerCase();
    if (!ct.includes("application/json")) {
      return NextResponse.json({ requestId, ok: false, error: "Unsupported content type." }, { status: 415, headers: NO_STORE_HEADERS });
    }

    const body = await readJsonBody(req);
    const b = asObj(body);
    const token = typeof b["token"] === "string" ? String(b["token"]).trim() : "";
    if (!token) {
      return NextResponse.json({ requestId, ok: false, error: "Missing token." }, { status: 400, headers: NO_STORE_HEADERS });
    }
    if (token.length > 4096) {
      return NextResponse.json({ requestId, ok: false, error: "Input too large." }, { status: 413, headers: NO_STORE_HEADERS });
    }

    const secret = process.env.TURNSTILE_SECRET_KEY;
    if (!secret) {
      return NextResponse.json({ requestId, ok: false, error: "Server not configured." }, { status: 500, headers: NO_STORE_HEADERS });
    }

    const form = new URLSearchParams();
    form.set("secret", secret);
    form.set("response", token);
    if (ip && ip !== "unknown") form.set("remoteip", ip);

    const verifyRes = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });

    const verifyJson: unknown = await verifyRes.json().catch(() => ({}));
    const v = asObj(verifyJson);

    if (v["success"] !== true) {
      return NextResponse.json({ requestId, ok: false, error: "Verification failed." }, { status: 403, headers: NO_STORE_HEADERS });
    }

    const allowed = (process.env.TURNSTILE_ALLOWED_HOSTNAMES || "").trim();
    if (allowed) {
      const hostname = typeof v["hostname"] === "string" ? String(v["hostname"]).trim().toLowerCase() : "";
      const allowedList = allowed
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);

      if (!hostname || !allowedList.includes(hostname)) {
        return NextResponse.json({ requestId, ok: false, error: "Verification failed." }, { status: 403, headers: NO_STORE_HEADERS });
      }
    }

    const cookieValue = await createHumanCookieValue(Date.now());
    const res = NextResponse.json({ requestId, ok: true }, { status: 200, headers: NO_STORE_HEADERS });

    res.cookies.set({
      name: HUMAN_COOKIE_NAME,
      value: cookieValue,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: HUMAN_COOKIE_MAX_AGE_SECONDS,
    });

    return res;
  } catch (e: unknown) {
    return NextResponse.json(
      { requestId, ok: false, error: e instanceof Error ? e.message : "Unknown error." },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
