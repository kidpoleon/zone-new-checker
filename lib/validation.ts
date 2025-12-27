export function normalizeUrl(input: string): string {
  // Normalize user input into an origin (scheme + host + optional port).
  // Xtream endpoints we call (player_api.php) are relative to the origin.
  const trimmed = (input || "").trim();
  if (!trimmed) throw new Error("URL is required.");

  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;

  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    throw new Error("Invalid URL.");
  }

  if (!u.hostname) throw new Error("Invalid URL.");

  // Strip path/query/fragment; we only want origin.
  return `${u.protocol}//${u.host}`;
}

export function normalizeStalkerUrl(input: string): string {
  // Normalize Stalker portal URL.
  // Unlike Xtream, many Stalker portals are hosted under a path (e.g. /c), so we preserve path.
  const trimmed = (input || "").trim();
  if (!trimmed) throw new Error("URL is required.");

  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;

  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    throw new Error("Invalid URL.");
  }

  if (!u.hostname) throw new Error("Invalid URL.");

  // Keep path (important for portals hosted under /c), but remove query/fragment.
  const cleanPath = u.pathname.replace(/\/+$/, "");
  return `${u.protocol}//${u.host}${cleanPath}`;
}

export function parsePortFromOrigin(origin: string): string {
  try {
    const u = new URL(origin);
    if (u.port) return u.port;
    if (u.protocol === "https:") return "443";
    return "80";
  } catch {
    return "";
  }
}

export function normalizeMac(input: string): string {
  // Accept common MAC formats and normalize to AA:BB:CC:DD:EE:FF.
  const raw = (input || "").trim();
  if (!raw) throw new Error("MAC address is required.");

  const cleaned = raw.replace(/[^a-fA-F0-9]/g, "").toUpperCase();
  if (cleaned.length !== 12) throw new Error("Invalid MAC address.");

  const parts = cleaned.match(/.{1,2}/g);
  if (!parts) throw new Error("Invalid MAC address.");
  return parts.join(":");
}

export function splitBulkLines(input: string, maxLines: number): string[] {
  // Split multiline bulk input into non-empty trimmed lines, enforcing a max for safety.
  const lines = (input || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) throw new Error("Bulk input is empty.");
  if (lines.length > maxLines) throw new Error(`Too many lines. Max allowed: ${maxLines}.`);
  return lines;
}

export function parseUserPassLine(line: string): { username: string; password: string } {
  // Bulk Xtream convenience: accept username/password pairs using a few common separators.
  // Accept username:password, username|password, username,password
  const separators = [":", "|", ","];
  for (const sep of separators) {
    const idx = line.indexOf(sep);
    if (idx > 0) {
      const username = line.slice(0, idx).trim();
      const password = line.slice(idx + 1).trim();
      if (!username || !password) break;
      return { username, password };
    }
  }
  throw new Error("Invalid line format. Use username:password per line.");
}

export function parseXtreamFromUrlLine(line: string): { url: string; username: string; password: string } {
  // Parse a full get.php / m3u URL pasted into bulk input.
  // Extracts origin and username/password query params.
  const trimmed = (line || "").trim();
  if (!trimmed) throw new Error("Empty line.");

  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    throw new Error("Invalid URL in bulk line.");
  }

  const username = (u.searchParams.get("username") || "").trim();
  const password = (u.searchParams.get("password") || "").trim();
  if (!username || !password) {
    throw new Error("URL line missing username/password query params.");
  }

  const origin = `${u.protocol}//${u.host}`;
  return { url: origin, username, password };
}

export function parseXtreamBulkLine(line: string, fallbackUrlOrigin: string): { url: string; username: string; password: string } {
  // Bulk Xtream supports either:
  // - full URLs (get.php/m3u) per line, OR
  // - username:password per line (with a separate base URL).
  const trimmed = (line || "").trim();
  if (!trimmed) throw new Error("Empty line.");

  // If user pasted full get.php/m3u URL, extract creds and origin from it.
  if (/^https?:\/\//i.test(trimmed) || trimmed.includes("get.php?") || trimmed.includes("m3u")) {
    try {
      return parseXtreamFromUrlLine(trimmed);
    } catch {
      // fall through to username:password parsing
    }
  }

  const { username, password } = parseUserPassLine(trimmed);
  return { url: fallbackUrlOrigin, username, password };
}
