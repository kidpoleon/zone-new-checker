import { NextResponse } from "next/server";
import { fetchWithTimeout } from "@/lib/http";

function pickContentType(u: string): string {
  // Fallback content-type detection when upstream doesn't provide one.
  const lower = u.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

export async function GET(req: Request) {
  const requestId = crypto.randomUUID();
  try {
    // Simple image proxy for channel logos.
    // Reasons:
    // - many portals block hotlinking
    // - many portals return relative logo URLs
    // - some portals have inconsistent CORS headers
    // We restrict to http/https URLs and cache successful responses.
    const { searchParams } = new URL(req.url);
    const target = (searchParams.get("url") || "").trim();
    if (!target) {
      return NextResponse.json({ requestId, ok: false, error: "Missing url." }, { status: 400 });
    }

    let u: URL;
    try {
      u = new URL(target);
    } catch {
      return NextResponse.json({ requestId, ok: false, error: "Invalid url." }, { status: 400 });
    }

    if (u.protocol !== "http:" && u.protocol !== "https:") {
      return NextResponse.json({ requestId, ok: false, error: "Unsupported protocol." }, { status: 400 });
    }

    const res = await fetchWithTimeout(u.toString(), {
      method: "GET",
      headers: {
        "User-Agent": "IPTVChecker/1.0",
        Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      },
      timeoutMs: 20000,
    });

    if (!res.ok) {
      return NextResponse.json({ requestId, ok: false, error: `Image fetch failed (HTTP ${res.status}).` }, { status: 502 });
    }

    const buf = await res.arrayBuffer();
    const contentType = res.headers.get("content-type") || pickContentType(u.pathname);

    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (e: any) {
    const msg = e?.name === "AbortError" ? "Request timed out." : (e?.message || "Unknown error.");
    return NextResponse.json({ requestId, ok: false, error: msg }, { status: 500 });
  }
}
