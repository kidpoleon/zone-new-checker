import { NextResponse } from "next/server";
import { isHumanVerified } from "@/lib/humanVerification";

// Simple in-memory rate limiting
const rateLimit = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const windowMs = 60 * 1000; // 1 minute window
  const maxRequests = 10;

  const current = rateLimit.get(ip);
  if (!current || now > current.resetAt) {
    rateLimit.set(ip, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (current.count >= maxRequests) {
    return false;
  }

  current.count++;
  return true;
}

/**
 * Resolve Reddit short links (e.g., /r/subreddit/s/XXXX) to full URLs
 */
async function resolveShortLink(url: string): Promise<{ success: boolean; url: string; error?: string }> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    
    const response = await fetch(url, {
      method: "HEAD",
      redirect: "manual",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      signal: controller.signal,
    });
    
    clearTimeout(timeout);
    
    // Check for redirect
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (location) {
        return { success: true, url: location };
      }
    }
    
    // If HEAD didn't work, try GET and parse the redirect
    const getResponse = await fetch(url, {
      method: "GET",
      redirect: "manual",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });
    
    if (getResponse.status >= 300 && getResponse.status < 400) {
      const location = getResponse.headers.get("location");
      if (location) {
        return { success: true, url: location };
      }
    }
    
    // If no redirect, return original
    return { success: true, url };
  } catch (e: unknown) {
    const error = e instanceof Error ? e.message : "Failed to resolve short link";
    return { success: false, url, error };
  }
}

/**
 * Check if URL is a Reddit short link
 */
function isShortLink(url: string): boolean {
  return /\/r\/[^/]+\/s\/[A-Za-z0-9]+/.test(url);
}

/**
 * Clean Reddit URL by removing tracking parameters
 */
function cleanRedditUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    // Remove common tracking parameters
    const trackingParams = [
      "utm_source", "utm_medium", "utm_name", "utm_term", "utm_content",
      "utm_campaign", "utm_id", "fbclid", "gclid", "ttclid", "share_id"
    ];
    trackingParams.forEach(param => urlObj.searchParams.delete(param));
    return urlObj.toString();
  } catch {
    return url;
  }
}

/**
 * Extract Base64 strings from text
 */
function extractBase64Strings(text: string): string[] {
  const base64Pattern = /[A-Za-z0-9+/_-]{8,}(?:={0,2})/g;
  const matches = text.match(base64Pattern) || [];
  // Filter to valid-looking Base64 (minimum length, contains typical chars)
  return matches.filter(m => {
    // Must be reasonable length for actual content
    if (m.length < 20) return false;
    // Check if it decodes (we'll validate later)
    return true;
  });
}

/**
 * Recursively extract text from Reddit comments
 */
function extractFromComments(comments: unknown[]): string {
  let text = "";
  
  for (const comment of comments) {
    if (typeof comment !== "object" || comment === null) continue;
    const c = comment as Record<string, unknown>;
    
    // Extract body from comment
    if (typeof c.body === "string") {
      text += " " + c.body;
    }
    
    // Recursively check replies
    if (typeof c.replies === "object" && c.replies !== null) {
      const replies = c.replies as Record<string, unknown>;
      if (typeof replies.data === "object" && replies.data !== null) {
        const data = replies.data as Record<string, unknown>;
        if (Array.isArray(data.children)) {
          text += extractFromComments(data.children);
        }
      }
    }
  }
  
  return text;
}

export async function POST(req: Request) {
  const now = Date.now();

  // Human verification check
  const verified = await isHumanVerified(req, now);
  if (!verified) {
    return NextResponse.json({ ok: false, error: "Verification required" }, { status: 403 });
  }

  // Rate limiting
  const ip = req.headers.get("x-forwarded-for") || "unknown";
  if (!checkRateLimit(ip)) {
    return NextResponse.json({ ok: false, error: "Rate limit exceeded. Try again in a minute." }, { status: 429 });
  }

  // Parse request body
  let body: { url?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request body" }, { status: 400 });
  }

  let { url } = body;
  if (!url || typeof url !== "string") {
    return NextResponse.json({ ok: false, error: "URL is required" }, { status: 400 });
  }

  // Trim and normalize URL
  url = url.trim();
  
  // Ensure URL has protocol
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    url = "https://" + url;
  }

  // Validate URL format
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid URL format. Please provide a valid Reddit URL." }, { status: 400 });
  }

  // Validate reddit.com domain
  if (!parsedUrl.hostname.endsWith("reddit.com") && !parsedUrl.hostname.endsWith("redd.it")) {
    return NextResponse.json({ ok: false, error: "Only reddit.com and redd.it URLs are supported" }, { status: 400 });
  }

  // Resolve short links if needed
  if (isShortLink(url)) {
    const resolved = await resolveShortLink(url);
    if (!resolved.success) {
      return NextResponse.json({ 
        ok: false, 
        error: `Failed to resolve short link: ${resolved.error || "Unknown error"}. Please try copying the full URL from your browser.` 
      }, { status: 400 });
    }
    url = resolved.url;
  }

  // Clean URL and add .json
  const cleanUrl = cleanRedditUrl(url);
  const jsonUrl = cleanUrl.replace(/\/?$/, "/") + ".json";

  // Fetch Reddit JSON
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000); // 15 second timeout

    const response = await fetch(jsonUrl, {
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ZoneNewChecker/1.0; +https://github.com)",
        "Accept": "application/json",
      },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      let errorMsg = `Reddit API returned ${response.status}`;
      if (response.status === 404) {
        errorMsg = "Post not found. It may have been deleted or the URL is incorrect.";
      } else if (response.status === 403) {
        errorMsg = "Access denied. The post may be private or require authentication.";
      } else if (response.status === 429) {
        errorMsg = "Reddit rate limit exceeded. Please wait a minute and try again.";
      } else if (response.status >= 500) {
        errorMsg = "Reddit servers are having issues. Please try again later.";
      }
      return NextResponse.json(
        { ok: false, error: errorMsg },
        { status: 502 }
      );
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      return NextResponse.json({ ok: false, error: "Failed to parse Reddit response. The API may have changed or the post is not accessible." }, { status: 502 });
    }
    
    if (!Array.isArray(data) || data.length < 1) {
      return NextResponse.json({ ok: false, error: "Invalid Reddit response format. The post structure may have changed or the post is not accessible via API." }, { status: 502 });
    }

    // Extract text from post and metadata
    let allText = "";
    let postMeta: { author?: string; createdUtc?: number; title?: string; subreddit?: string } = {};
    
    // Post data is in first element
    const postListing = data[0] as Record<string, unknown>;
    if (typeof postListing.data === "object" && postListing.data !== null) {
      const listingData = postListing.data as Record<string, unknown>;
      if (Array.isArray(listingData.children) && listingData.children.length > 0) {
        const post = listingData.children[0] as Record<string, unknown>;
        const postData = post.data as Record<string, unknown>;
        
        // Extract post content
        if (typeof postData.selftext === "string") {
          allText += " " + postData.selftext;
        }
        if (typeof postData.title === "string") {
          allText += " " + postData.title;
          postMeta.title = postData.title;
        }
        
        // Extract metadata
        if (typeof postData.author === "string") {
          postMeta.author = postData.author;
        }
        if (typeof postData.created_utc === "number") {
          postMeta.createdUtc = postData.created_utc;
        }
        if (typeof postData.subreddit === "string") {
          postMeta.subreddit = postData.subreddit;
        }
      }
    }
    
    // Extract text from comments (second element)
    if (data.length > 1) {
      const commentsListing = data[1] as Record<string, unknown>;
      if (typeof commentsListing.data === "object" && commentsListing.data !== null) {
        const listingData = commentsListing.data as Record<string, unknown>;
        if (Array.isArray(listingData.children)) {
          allText += extractFromComments(listingData.children);
        }
      }
    }

    // Extract Base64 strings
    const base64Strings = extractBase64Strings(allText);
    
    // Remove duplicates while preserving order
    const seen = new Set<string>();
    const uniqueBase64: string[] = [];
    for (const str of base64Strings) {
      if (!seen.has(str)) {
        seen.add(str);
        uniqueBase64.push(str);
      }
    }

    return NextResponse.json({
      ok: true,
      url: cleanUrl,
      base64Strings: uniqueBase64,
      count: uniqueBase64.length,
      meta: postMeta,
    });
  } catch (e: unknown) {
    const errorMsg = e instanceof Error ? e.message : "Failed to fetch Reddit content";
    return NextResponse.json({ ok: false, error: errorMsg }, { status: 502 });
  }
}
