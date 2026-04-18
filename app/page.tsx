"use client";

import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Script from "next/script";
import type { BulkRowResult, CheckResult, Mode, RunMode } from "@/lib/types";
import {
  normalizeMac,
  normalizeStalkerUrl,
  normalizeUrl,
  parseXtreamFromUrlLine,
} from "@/lib/validation";

type XtreamPlaylistCategory = { id: string; name: string };
type XtreamPlaylistChannel = { id: string; name: string; logo?: string };

type StalkerPlaylistGenre = { id: string; name: string };
type StalkerPlaylistChannel = { id: string; name: string; logo?: string };

type PlaylistPrefs = {
  xtream: Record<string, { lastCategoryId?: string }>;
  stalker: Record<string, { lastGenreId?: string }>;
};

function VirtualList<T>({
  items,
  itemHeight,
  height,
  gap = 8,
  render,
  className,
}: {
  items: T[];
  itemHeight: number;
  height: number;
  gap?: number;
  render: (item: T, idx: number) => JSX.Element;
  className?: string;
}) {
  // Minimal virtualization for fast scrolling through large channel lists.
  // We only render the visible window + overscan items to keep the UI responsive.
  const [scrollTop, setScrollTop] = useState(0);
  const total = items.length;
  const overscan = 8;
  const step = itemHeight + gap;
  const start = Math.max(0, Math.floor(scrollTop / step) - overscan);
  const visibleCount = Math.ceil(height / step) + overscan * 2;
  const end = Math.min(total, start + visibleCount);
  const offsetY = start * step;

  return (
    <div
      className={className}
      style={{ height, overflow: "auto" }}
      onScroll={(e) => {
        setScrollTop(e.currentTarget.scrollTop);
      }}
    >
      <div style={{ height: Math.max(0, total * step - gap), position: "relative" }}>
        <div style={{ position: "absolute", top: offsetY, left: 0, right: 0, display: "grid", gap }}>
          {items.slice(start, end).map((it, i) => render(it, start + i))}
        </div>
      </div>
    </div>
  );
}

type XtreamSingleState = { url: string; username: string; password: string };
type StalkerSingleState = { url: string; mac: string };

type XtreamBulkState = { lines: string };
type StalkerBulkState = { url: string; macs: string };

type BulkSortKey = "input" | "status" | "expiry" | "maxConnections" | "timezone" | "portalIp" | "channels";
type BulkSortDir = "asc" | "desc";
type BulkSortState = { key: BulkSortKey; dir: BulkSortDir } | null;

const LS_KEY_V2 = "iptv_checker_v2";
const LS_KEY_V1 = "iptv_checker_v1";
const LS_PLAYLIST_PREFS = "iptv_checker_v2_playlist_prefs";

function emptyResult(): CheckResult {
  return { ok: false, error: "", expiryDate: "", maxConnections: "", realUrl: "", port: "", timezone: "" };
}

function ResultKV({ label, value }: { label: string; value: string }) {
  return (
    <div className="kv">
      <div className="k">{label}</div>
      <div className="v">{value || "N/A"}</div>
    </div>
  );
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : "Unknown error.";
}

function asObj(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
}

export default function HomePage() {
  const [mode, setMode] = useState<Mode>("xtream");
  const [runMode, setRunMode] = useState<RunMode>("single");

  const [xtreamPlaylistTab, setXtreamPlaylistTab] = useState<"list" | "channels">("list");
  const [stalkerPlaylistTab, setStalkerPlaylistTab] = useState<"list" | "channels">("list");

  const [xtreamChannelSort, setXtreamChannelSort] = useState<"name" | "id">("name");
  const [xtreamChannelSortDir, setXtreamChannelSortDir] = useState<BulkSortDir>("asc");
  const [stalkerChannelSort, setStalkerChannelSort] = useState<"name" | "id">("name");
  const [stalkerChannelSortDir, setStalkerChannelSortDir] = useState<BulkSortDir>("asc");

  const [xtreamSingle, setXtreamSingle] = useState<XtreamSingleState>({ url: "", username: "", password: "" });
  const [stalkerSingle, setStalkerSingle] = useState<StalkerSingleState>({ url: "", mac: "" });

  const [xtreamBulk, setXtreamBulk] = useState<XtreamBulkState>({ lines: "" });
  const [stalkerBulk, setStalkerBulk] = useState<StalkerBulkState>({ url: "", macs: "" });

  // Base64 decoder state
  const [base64Input, setBase64Input] = useState<string>("");
  const [base64Output, setBase64Output] = useState<string>("");
  const [base64Error, setBase64Error] = useState<string>("");
  const [base64Urls, setBase64Urls] = useState<string[]>([]);
  const [hasInput, setHasInput] = useState<boolean>(false);
  
  // Smart validation state
  const [validationStatus, setValidationStatus] = useState<"empty" | "invalid" | "partial" | "valid">("empty");
  const [detectedType, setDetectedType] = useState<"none" | "base64" | "url" | "xtream" | "stalker">("none");
  const [isFirstTimeUser, setIsFirstTimeUser] = useState<boolean>(false);
  const [showHint, setShowHint] = useState<boolean>(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>("");

  const [singleResult, setSingleResult] = useState<CheckResult>(emptyResult());
  const [bulkResults, setBulkResults] = useState<BulkRowResult[]>([]);

  const [bulkTotal, setBulkTotal] = useState(0);
  const [bulkDone, setBulkDone] = useState(0);
  const [bulkSort, setBulkSort] = useState<BulkSortState>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [playlistBusy, setPlaylistBusy] = useState(false);
  const [playlistError, setPlaylistError] = useState<string>("");

  const [xtreamCats, setXtreamCats] = useState<XtreamPlaylistCategory[]>([]);
  const [xtreamCatId, setXtreamCatId] = useState<string>("");
  const [xtreamChannels, setXtreamChannels] = useState<XtreamPlaylistChannel[]>([]);
  const [xtreamSearch, setXtreamSearch] = useState<string>("");
  const [xtreamCatSearch, setXtreamCatSearch] = useState<string>("");

  const [copiedXtreamStreamId, setCopiedXtreamStreamId] = useState<string>("");
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "info" | "warning" } | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const [xtreamHoverUrl, setXtreamHoverUrl] = useState<string>("");

  const [stalkerGenres, setStalkerGenres] = useState<StalkerPlaylistGenre[]>([]);
  const [stalkerGenreId, setStalkerGenreId] = useState<string>("");
  const [stalkerChannels, setStalkerChannels] = useState<StalkerPlaylistChannel[]>([]);
  const [stalkerSearch, setStalkerSearch] = useState<string>("");
  const [stalkerGenreSearch, setStalkerGenreSearch] = useState<string>("");

  const [xtreamSearchDebounced, setXtreamSearchDebounced] = useState<string>("");
  const [stalkerSearchDebounced, setStalkerSearchDebounced] = useState<string>("");

  const [viewportH, setViewportH] = useState<number>(0);

  // Proactive verification state
  const [isVerified, setIsVerified] = useState<boolean | null>(null); // null = checking, false = unverified, true = verified
  const [turnstileToken, setTurnstileToken] = useState<string>("");
  const [turnstileError, setTurnstileError] = useState<string>("");
  const [verifying, setVerifying] = useState(false);
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "";

  const canShowSingle = runMode === "single";

  const redirectToVerify = useCallback(() => {
    const returnTo = `${window.location.pathname}${window.location.search}`;
    const qp = new URLSearchParams({ returnTo });
    window.location.assign(`/verify?${qp.toString()}`);
  }, []);

  const handleMaybeVerifyRequired = useCallback(
    (res: Response, jsonObj: Record<string, unknown>): boolean => {
      if (res.status === 403 && jsonObj["code"] === "human_verification_required") {
        abortRef.current?.abort();
        setBusy(false);
        setPlaylistBusy(false);
        // Instead of redirect, show inline verification
        setIsVerified(false);
        setTurnstileToken("");
        setTurnstileError("");
        return true;
      }
      return false;
    },
    []
  );

  // Check verification status on mount (proactive verification)
  useEffect(() => {
    // Skip if no site key configured (local development)
    if (!siteKey) {
      setIsVerified(true);
      return;
    }

    const checkVerification = async () => {
      try {
        const res = await fetch("/api/check-verification");
        const json = await res.json().catch(() => ({}));
        setIsVerified(json.verified === true);
      } catch {
        // On error, assume unverified to be safe
        setIsVerified(false);
      }
    };

    checkVerification();
  }, [siteKey]);

  // First-time user detection
  useEffect(() => {
    if (typeof window === "undefined") return;
    const hasUsedBase64 = localStorage.getItem("zone_checker_base64_used");
    if (!hasUsedBase64) {
      setIsFirstTimeUser(true);
      setShowHint(true);
      // Auto-hide hint after 8 seconds
      const timer = setTimeout(() => setShowHint(false), 8000);
      return () => clearTimeout(timer);
    }
  }, []);

  // Smart input validation and type detection
  useEffect(() => {
    const trimmed = base64Input.trim();
    
    if (!trimmed) {
      setValidationStatus("empty");
      setDetectedType("none");
      return;
    }
    
    // Auto-trim whitespace detection
    const hasWhitespace = /\s/.test(base64Input);
    if (hasWhitespace && trimmed !== base64Input) {
      // Silently clean the input after a brief delay
      const timer = setTimeout(() => {
        setBase64Input(trimmed);
        showToast("Auto-removed extra spaces", "info");
      }, 500);
      return () => clearTimeout(timer);
    }
    
    // Detect input type
    const isUrl = /^https?:\/\//i.test(trimmed);
    const isXtream = isUrl && (/\/get\.php/i.test(trimmed) || trimmed.includes("username=") || trimmed.includes("password="));
    const isStalker = isUrl && (/\/c\/|\/portal/i.test(trimmed) || /[a-f0-9]{2}:[a-f0-9]{2}/i.test(trimmed));
    const isBase64 = /^[A-Za-z0-9+/=_-]+$/.test(trimmed) && trimmed.length >= 4;
    
    // Check if valid Base64
    const isValidBase64 = (str: string): boolean => {
      try {
        const normalized = str.replace(/-/g, "+").replace(/_/g, "/");
        const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
        atob(padded);
        return true;
      } catch {
        return false;
      }
    };
    
    if (isXtream) {
      setDetectedType("xtream");
      setValidationStatus("invalid");
    } else if (isStalker) {
      setDetectedType("stalker");
      setValidationStatus("invalid");
    } else if (isUrl && !isBase64) {
      setDetectedType("url");
      setValidationStatus("invalid");
    } else if (isBase64) {
      setDetectedType("base64");
      if (isValidBase64(trimmed)) {
        setValidationStatus("valid");
      } else {
        // Check if it's close (partial padding issue)
        const cleanBase64 = trimmed.replace(/[^A-Za-z0-9+/]/g, "");
        if (cleanBase64.length >= trimmed.length * 0.8) {
          setValidationStatus("partial");
        } else {
          setValidationStatus("invalid");
        }
      }
    } else {
      setDetectedType("none");
      setValidationStatus("invalid");
    }
  }, [base64Input]);

  // Handle Turnstile callbacks
  useEffect(() => {
    if (typeof window === "undefined") return;

    (window as unknown as Record<string, unknown>).onTurnstileSuccess = (token: string) => {
      setTurnstileToken(token);
      setTurnstileError("");
    };
    (window as unknown as Record<string, unknown>).onTurnstileError = () => {
      setTurnstileError("Verification failed to load. Please refresh and try again.");
      setTurnstileToken("");
    };
    (window as unknown as Record<string, unknown>).onTurnstileExpired = () => {
      setTurnstileError("Verification expired. Please try again.");
      setTurnstileToken("");
    };
    (window as unknown as Record<string, unknown>).onTurnstileTimeout = () => {
      setTurnstileError("Verification timed out. Please try again.");
      setTurnstileToken("");
    };

    return () => {
      delete (window as unknown as Record<string, unknown>).onTurnstileSuccess;
      delete (window as unknown as Record<string, unknown>).onTurnstileError;
      delete (window as unknown as Record<string, unknown>).onTurnstileExpired;
      delete (window as unknown as Record<string, unknown>).onTurnstileTimeout;
    };
  }, []);

  // Submit verification when token is received
  useEffect(() => {
    if (!turnstileToken || verifying) return;

    const submitVerification = async () => {
      setVerifying(true);
      try {
        const res = await fetch("/api/verify-human", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-ZoneNew-Client": "1" },
          body: JSON.stringify({ token: turnstileToken }),
        });
        const json = await res.json().catch(() => ({}));

        if (res.ok && json.ok === true) {
          setIsVerified(true);
          setTurnstileError("");
          showToast("Verification successful! You can now use all features.", "success");
        } else {
          throw new Error(json.error || "Verification failed.");
        }
      } catch (e: unknown) {
        setTurnstileError(e instanceof Error ? e.message : "Verification failed.");
        setTurnstileToken("");
      } finally {
        setVerifying(false);
      }
    };

    submitVerification();
  }, [turnstileToken, verifying]);

  useEffect(() => {
    const update = () => setViewportH(window.innerHeight || 0);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const xtreamListHeight = useMemo(() => {
    const base = viewportH ? Math.floor(viewportH * 0.62) : 520;
    return Math.max(420, Math.min(900, base));
  }, [viewportH]);

  useEffect(() => {
    try {
      const rawV2 = localStorage.getItem(LS_KEY_V2);
      const rawV1 = rawV2 ? null : localStorage.getItem(LS_KEY_V1);
      const raw = rawV2 || rawV1;
      if (!raw) return;
      const parsed = JSON.parse(raw);

      const p = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};

      const m = p["mode"];
      if (m === "xtream" || m === "stalker") setMode(m);

      const rm = p["runMode"];
      if (rm === "single" || rm === "bulk") setRunMode(rm);

      const xs = p["xtreamSingle"];
      if (typeof xs === "object" && xs !== null) {
        const o = xs as Record<string, unknown>;
        setXtreamSingle({
          url: typeof o["url"] === "string" ? o["url"] : "",
          username: typeof o["username"] === "string" ? o["username"] : "",
          password: typeof o["password"] === "string" ? o["password"] : "",
        });
      }

      const ss = p["stalkerSingle"];
      if (typeof ss === "object" && ss !== null) {
        const o = ss as Record<string, unknown>;
        setStalkerSingle({
          url: typeof o["url"] === "string" ? o["url"] : "",
          mac: typeof o["mac"] === "string" ? o["mac"] : "",
        });
      }

      const xb = p["xtreamBulk"];
      if (typeof xb === "object" && xb !== null) {
        const o = xb as Record<string, unknown>;
        setXtreamBulk({ lines: typeof o["lines"] === "string" ? o["lines"] : "" });
      }

      const sb = p["stalkerBulk"];
      if (typeof sb === "object" && sb !== null) {
        const o = sb as Record<string, unknown>;
        setStalkerBulk({
          url: typeof o["url"] === "string" ? o["url"] : "",
          macs: typeof o["macs"] === "string" ? o["macs"] : "",
        });
      }

      const sr = p["singleResult"];
      if (typeof sr === "object" && sr !== null) {
        const o = sr as Record<string, unknown>;
        const ok = o["ok"] === true;
        setSingleResult({
          ok,
          error: typeof o["error"] === "string" ? o["error"] : "",
          expiryDate: typeof o["expiryDate"] === "string" ? o["expiryDate"] : "",
          expiryTs: typeof o["expiryTs"] === "number" ? o["expiryTs"] : undefined,
          maxConnections: typeof o["maxConnections"] === "string" ? o["maxConnections"] : "",
          activeConnections: typeof o["activeConnections"] === "string" ? o["activeConnections"] : undefined,
          realUrl: typeof o["realUrl"] === "string" ? o["realUrl"] : "",
          port: typeof o["port"] === "string" ? o["port"] : "",
          timezone: typeof o["timezone"] === "string" ? o["timezone"] : "",
          portalIp: typeof o["portalIp"] === "string" ? o["portalIp"] : undefined,
          channels: typeof o["channels"] === "string" ? o["channels"] : undefined,
        });
      }

      const br = p["bulkResults"];
      if (Array.isArray(br)) {
        const next: BulkRowResult[] = [];
        for (const item of br) {
          if (typeof item !== "object" || item === null) continue;
          const o = item as Record<string, unknown>;
          const resultRaw = o["result"];
          if (typeof resultRaw !== "object" || resultRaw === null) continue;
          const r = resultRaw as Record<string, unknown>;
          next.push({
            lineNumber: typeof o["lineNumber"] === "number" ? o["lineNumber"] : undefined,
            input: typeof o["input"] === "string" ? o["input"] : "",
            result: {
              ok: r["ok"] === true,
              error: typeof r["error"] === "string" ? r["error"] : "",
              expiryDate: typeof r["expiryDate"] === "string" ? r["expiryDate"] : "",
              expiryTs: typeof r["expiryTs"] === "number" ? r["expiryTs"] : undefined,
              maxConnections: typeof r["maxConnections"] === "string" ? r["maxConnections"] : "",
              activeConnections: typeof r["activeConnections"] === "string" ? r["activeConnections"] : undefined,
              realUrl: typeof r["realUrl"] === "string" ? r["realUrl"] : "",
              port: typeof r["port"] === "string" ? r["port"] : "",
              timezone: typeof r["timezone"] === "string" ? r["timezone"] : "",
              portalIp: typeof r["portalIp"] === "string" ? r["portalIp"] : undefined,
              channels: typeof r["channels"] === "string" ? r["channels"] : undefined,
            },
          });
        }
        setBulkResults(next);
      }

      // Best-effort migration: if we loaded v1, immediately save into v2.
      if (rawV1) {
        try {
          localStorage.setItem(LS_KEY_V2, JSON.stringify(parsed));
        } catch {
          // ignore
        }
      }
    } catch {
      // Ignore corrupt storage
    }
  }, []);

  function logoSrc(logo?: string): string {
    const raw = (logo || "").trim();
    if (!raw) return "";
    return `/api/image?client=1&url=${encodeURIComponent(raw)}`;
  }

  function stopBulk() {
    abortRef.current?.abort();
  }

  async function runPool<T>(items: T[], concurrency: number, worker: (item: T, idx: number) => Promise<void>) {
    // Concurrency-limited worker pool.
    // Keeps bulk checks fast but prevents browser/serverless overload.
    const pool = new Set<Promise<void>>();

    for (let i = 0; i < items.length; i++) {
      const p = worker(items[i], i)
        .catch(() => {
          // worker is responsible for recording errors into results
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

  useEffect(() => {
    const payload = {
      mode,
      runMode,
      xtreamSingle,
      stalkerSingle,
      xtreamBulk,
      stalkerBulk,
      singleResult,
      bulkResults,
    };
    try {
      localStorage.setItem(LS_KEY_V2, JSON.stringify(payload));
    } catch {
      // storage may be blocked
    }
  }, [mode, runMode, xtreamSingle, stalkerSingle, xtreamBulk, stalkerBulk, singleResult, bulkResults]);

  const activeTitle = useMemo(() => {
    if (mode === "base64") return "Base64 Decoder";
    const left = mode === "xtream" ? "Xtream" : "Stalker (MAC)";
    const right = runMode === "single" ? "Single" : "Bulk";
    return `${left} • ${right}`;
  }, [mode, runMode]);

  const sortedBulkResults = useMemo(() => {
    const parseExpiryTs = (v: unknown): number => {
      if (typeof v !== "string") return Number.POSITIVE_INFINITY;
      const s = v.trim();
      if (!s || s === "N/A") return Number.POSITIVE_INFINITY;
      if (s === "No Expiry") return Number.POSITIVE_INFINITY;

      // Epoch seconds/millis
      if (/^[0-9]{9,13}$/.test(s)) {
        let n = Number(s);
        if (!Number.isFinite(n) || n <= 0) return Number.POSITIVE_INFINITY;
        if (s.length >= 13) n = Math.floor(n / 1000);
        const t = n * 1000;
        return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
      }

      // YYYY-MM-DD
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
        const t = Date.parse(`${s}T00:00:00Z`);
        return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
      }

      // YYYY-MM-DD HH:MM:SS (or without seconds)
      const m = /^([0-9]{4})-([0-9]{2})-([0-9]{2})\s+([0-9]{2}):([0-9]{2})(?::([0-9]{2}))?$/.exec(s);
      if (m) {
        const yyyy = Number(m[1]);
        const mm = Number(m[2]);
        const dd = Number(m[3]);
        const hh = Number(m[4]);
        const mi = Number(m[5]);
        const ss = m[6] ? Number(m[6]) : 0;
        if (yyyy > 0 && mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
          const t = Date.UTC(yyyy, mm - 1, dd, hh, mi, ss);
          return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
        }
      }

      // Browser-native parsing fallback (covers strings like "June 29, 2026, 12:00 am").
      // We only use this as a last resort since it can be locale-dependent, but it's
      // better than treating every row as Infinity (which makes sorting appear broken).
      const native = Date.parse(s);
      if (Number.isFinite(native)) return native;

      return Number.POSITIVE_INFINITY;
    };

    const parseIntSafe = (v: unknown): number => {
      const n = typeof v === "number" ? v : Number(String(v ?? "").trim());
      return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
    };

    const parseIpKey = (v: unknown): number[] => {
      if (typeof v !== "string") return [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
      const s = v.trim();
      const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
      if (!m) return [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
      const parts = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
      for (const p of parts) {
        if (!Number.isFinite(p) || p < 0 || p > 255) {
          return [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
        }
      }
      return parts;
    };

    const withIdx = bulkResults.map((r, idx) => ({ r, idx }));

    // "None" state: return original stable input order.
    if (!bulkSort) {
      withIdx.sort((aa, bb) => {
        const a = aa.r;
        const b = bb.r;
        const an = a.lineNumber ?? Number.MAX_SAFE_INTEGER;
        const bn = b.lineNumber ?? Number.MAX_SAFE_INTEGER;
        if (an !== bn) return an - bn;
        return aa.idx - bb.idx;
      });
      return withIdx.map((x) => x.r);
    }

    const dir = bulkSort.dir === "asc" ? 1 : -1;
    const bulkSortKey = bulkSort.key;

    withIdx.sort((aa, bb) => {
      const a = aa.r;
      const b = bb.r;

      if (bulkSortKey === "input") {
        const c = a.input.localeCompare(b.input);
        if (c !== 0) return c * dir;
      } else if (bulkSortKey === "status") {
        // Availability: OK first
        const ao = a.result.ok ? 0 : 1;
        const bo = b.result.ok ? 0 : 1;
        if (ao !== bo) return (ao - bo) * dir;
        const am = (a.result.ok ? "OK" : a.result.error || "").toLowerCase();
        const bm = (b.result.ok ? "OK" : b.result.error || "").toLowerCase();
        const c = am.localeCompare(bm);
        if (c !== 0) return c * dir;
      } else if (bulkSortKey === "expiry") {
        const at = typeof a.result.expiryTs === "number" && Number.isFinite(a.result.expiryTs) ? a.result.expiryTs : parseExpiryTs(a.result.expiryDate);
        const bt = typeof b.result.expiryTs === "number" && Number.isFinite(b.result.expiryTs) ? b.result.expiryTs : parseExpiryTs(b.result.expiryDate);
        if (at !== bt) return (at - bt) * dir;
      } else if (bulkSortKey === "maxConnections") {
        const at = parseIntSafe(a.result.maxConnections);
        const bt = parseIntSafe(b.result.maxConnections);
        if (at !== bt) return (at - bt) * dir;
      } else if (bulkSortKey === "timezone") {
        const at = String(a.result.timezone || "").trim().toLowerCase();
        const bt = String(b.result.timezone || "").trim().toLowerCase();
        const c = at.localeCompare(bt);
        if (c !== 0) return c * dir;
      } else if (bulkSortKey === "portalIp") {
        const ak = parseIpKey(a.result.portalIp);
        const bk = parseIpKey(b.result.portalIp);
        for (let i = 0; i < 4; i++) {
          if (ak[i] !== bk[i]) return (ak[i] - bk[i]) * dir;
        }
      } else if (bulkSortKey === "channels") {
        const at = parseIntSafe(a.result.channels);
        const bt = parseIntSafe(b.result.channels);
        if (at !== bt) return (at - bt) * dir;
      }

      // Stable fallback: original input order, then insertion order
      const an = a.lineNumber ?? Number.MAX_SAFE_INTEGER;
      const bn = b.lineNumber ?? Number.MAX_SAFE_INTEGER;
      if (an !== bn) return an - bn;
      return aa.idx - bb.idx;
    });

    return withIdx.map((x) => x.r);
  }, [bulkResults, bulkSort]);

  function toggleBulkSort(key: BulkSortKey) {
    startTransition(() => {
      setBulkSort((cur) => {
        const defaultDir: BulkSortDir = key === "expiry" ? "desc" : "asc";
        const oppositeDir: BulkSortDir = defaultDir === "asc" ? "desc" : "asc";

        // none -> default
        if (!cur) return { key, dir: defaultDir };

        // different key -> default
        if (cur.key !== key) return { key, dir: defaultDir };

        // same key: default -> opposite -> none
        if (cur.dir === defaultDir) return { key, dir: oppositeDir };
        return null;
      });
    });
  }

  function sortIndicator(key: BulkSortKey): string {
    if (!bulkSort || bulkSort.key !== key) return "";
    return bulkSort.dir === "asc" ? "↑" : "↓";
  }

  // Base64 decode functions - intelligent extraction and decoding
  // paste.sh URLs always start with "aHR0cHM6Ly9wYXN0ZS5z" (https://paste.s)
  const PASTESH_SIGNATURE = "aHR0cHM6Ly9wYXN0ZS5z";

  function cleanInvalidBase64Chars(input: string): string {
    // Keep only valid Base64 characters
    // Standard: A-Za-z0-9+/  URL-safe: A-Za-z0-9-_
    return input.replace(/[^A-Za-z0-9+\/_=-]/g, "");
  }

  function isValidBase64(str: string): boolean {
    // Check if string can be decoded
    try {
      const normalized = normalizeBase64(str);
      atob(normalized);
      return true;
    } catch {
      return false;
    }
  }

  function extractBase64FromMessyInput(input: string): string | null {
    // Remove all whitespace, newlines
    const cleaned = input.replace(/\s+/g, "");
    
    // Strategy 1: Look for paste.sh signature and extract from there
    const pasteShIndex = cleaned.indexOf(PASTESH_SIGNATURE);
    if (pasteShIndex !== -1) {
      // Start from the signature, extract valid base64 characters only
      let base64Candidate = "";
      let paddingCount = 0;
      for (let i = pasteShIndex; i < cleaned.length; i++) {
        const char = cleaned[i];
        // Valid base64 chars: A-Z, a-z, 0-9, +, /, -, _, =
        if (/[A-Za-z0-9+\/_=-]/.test(char)) {
          base64Candidate += char;
          // Track padding - once we see =, we're at the end of base64
          if (char === "=") {
            paddingCount++;
            // Base64 can have 0, 1, or 2 padding chars at the end
            // After we've collected padding, we're done
            if (paddingCount >= 2) break;
            // Check if next char is also padding or non-base64
            const nextChar = cleaned[i + 1];
            if (nextChar !== "=" && !/[A-Za-z0-9+\/_-]/.test(nextChar)) {
              break;
            }
          }
        } else {
          // Stop at first invalid character
          break;
        }
      }
      
      if (base64Candidate.length >= 8 && isValidBase64(base64Candidate)) {
        return base64Candidate;
      }
    }
    
    // Strategy 2: Find paste.sh signature inside long sequences and extract valid base64
    // This handles cases like "SometextaHR0cHM6Ly9wYXN0ZS5zaC95am0zazltMmc="
    const base64Chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=_-";
    let currentSequence = "";
    let bestValidSequence: string | null = null;
    
    for (let i = 0; i < cleaned.length; i++) {
      const char = cleaned[i];
      if (base64Chars.includes(char)) {
        currentSequence += char;
      } else {
        // End of sequence, process it
        if (currentSequence.length >= 8) {
          // Check if this sequence contains the paste.sh signature
          const sigIndex = currentSequence.indexOf(PASTESH_SIGNATURE);
          if (sigIndex !== -1) {
            // Extract from signature to end, stopping at padding
            let candidate = "";
            let paddingSeen = false;
            for (let j = sigIndex; j < currentSequence.length; j++) {
              const c = currentSequence[j];
              if (c === "=") paddingSeen = true;
              if (paddingSeen && c !== "=") break;
              candidate += c;
            }
            if (candidate.length >= 8 && isValidBase64(candidate)) {
              // This is a paste.sh URL - prioritize it
              return candidate;
            }
          }
          // Also check if the whole sequence is valid
          if (isValidBase64(currentSequence)) {
            if (!bestValidSequence || currentSequence.length > bestValidSequence.length) {
              bestValidSequence = currentSequence;
            }
          }
        }
        currentSequence = "";
      }
    }
    
    // Check the last sequence
    if (currentSequence.length >= 8) {
      const sigIndex = currentSequence.indexOf(PASTESH_SIGNATURE);
      if (sigIndex !== -1) {
        let candidate = "";
        let paddingSeen = false;
        for (let j = sigIndex; j < currentSequence.length; j++) {
          const c = currentSequence[j];
          if (c === "=") paddingSeen = true;
          if (paddingSeen && c !== "=") break;
          candidate += c;
        }
        if (candidate.length >= 8 && isValidBase64(candidate)) {
          return candidate;
        }
      }
      if (isValidBase64(currentSequence)) {
        if (!bestValidSequence || currentSequence.length > bestValidSequence.length) {
          bestValidSequence = currentSequence;
        }
      }
    }
    
    if (bestValidSequence) return bestValidSequence;
    
    // Strategy 3: Fallback - try regex pattern matching for any long sequences
    const base64Pattern = /[A-Za-z0-9+\/_-]{8,}(?:=[=]{0,2})?/g;
    const matches = cleaned.match(base64Pattern);
    
    if (matches && matches.length > 0) {
      // Sort by length descending and return longest
      const sorted = matches.sort((a, b) => b.length - a.length);
      const cleaned = cleanInvalidBase64Chars(sorted[0]);
      if (isValidBase64(cleaned)) return cleaned;
    }
    
    return null;
  }

  function normalizeBase64(input: string): string {
    // Convert URL-safe Base64 to standard Base64
    let normalized = input.replace(/-/g, "+").replace(/_/g, "/");
    
    // Add padding if missing
    const padLength = (4 - (normalized.length % 4)) % 4;
    normalized += "=".repeat(padLength);
    
    return normalized;
  }

  function extractUrls(text: string): string[] {
    // Extract URLs from text (http/https)
    const urlPattern = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi;
    return text.match(urlPattern) || [];
  }

  function decodeBase64(input: string): { decoded: string; urls: string[]; extractedBase64: string } {
    // Step 1: Extract Base64 from messy input
    const extractedBase64 = extractBase64FromMessyInput(input);
    if (!extractedBase64) throw new Error("No valid Base64 found in input");
    
    // Step 2: Normalize (handle URL-safe Base64)
    const normalized = normalizeBase64(extractedBase64);
    
    // Step 3: Decode
    let decoded: string;
    try {
      decoded = atob(normalized);
    } catch {
      // Try with UTF-8 decoding for non-ASCII
      try {
        const binary = atob(normalized);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        decoded = new TextDecoder().decode(bytes);
      } catch (e) {
        throw new Error("Invalid Base64 string - extraction found: " + extractedBase64.slice(0, 20) + "...");
      }
    }
    
    // Step 4: Extract URLs from decoded content
    const urls = extractUrls(decoded);
    
    return { decoded, urls, extractedBase64 };
  }

  function handleBase64Decode() {
    // Mark user as having used Base64 feature
    if (typeof window !== "undefined") {
      localStorage.setItem("zone_checker_base64_used", "true");
      setIsFirstTimeUser(false);
      setShowHint(false);
    }
    
    setBase64Error("");
    setBase64Output("");
    setBase64Urls([]);
    try {
      const result = decodeBase64(base64Input);
      setBase64Output(result.decoded);
      setBase64Urls(result.urls);
      showToast("Decoded successfully!", "success");
    } catch (e) {
      setBase64Error(e instanceof Error ? e.message : "Decode failed");
      showToast("Decode failed", "error");
    }
  }

  function openInPasteSh(urlToOpen?: string) {
    const targetUrl = urlToOpen || "https://paste.sh";
    window.open(targetUrl, "_blank", "noopener,noreferrer");
  }

  // Smart paste handler - detects if clipboard has content and auto-decodes if it's valid Base64
  async function smartPasteAndDecode() {
    try {
      const text = await navigator.clipboard.readText();
      if (!text || !text.trim()) {
        setBase64Error("Clipboard is empty.");
        return;
      }
      
      // Mark user as having used Base64 feature
      if (typeof window !== "undefined") {
        localStorage.setItem("zone_checker_base64_used", "true");
        setIsFirstTimeUser(false);
      }
      
      // Smart detection: check if pasted content is a URL instead of Base64
      const trimmed = text.trim();
      const isXtreamUrl = /^https?:\/\//i.test(trimmed) && (/\/get\.php/i.test(trimmed) || trimmed.includes("username="));
      const isStalkerUrl = /^https?:\/\//i.test(trimmed) && (/\/c\/|\/portal/i.test(trimmed) || /[a-f0-9]{2}:[a-f0-9]{2}/i.test(trimmed));
      
      if (isXtreamUrl) {
        setBase64Input(trimmed);
        setHasInput(true);
        setBase64Error("⚠️ This looks like an Xtream URL. Switch to 'Xtream' mode above to check it.");
        showToast("URL detected - switch to Xtream mode", "warning");
        return;
      }
      
      if (isStalkerUrl) {
        setBase64Input(trimmed);
        setHasInput(true);
        setBase64Error("⚠️ This looks like a Stalker URL. Switch to 'Stalker' mode above to check it.");
        showToast("URL detected - switch to Stalker mode", "warning");
        return;
      }
      
      setBase64Input(text);
      setHasInput(true);
      setBase64Error("");
      setBase64Output("");
      setBase64Urls([]);
      
      // Auto-decode if valid Base64 detected
      try {
        const result = decodeBase64(text);
        setBase64Output(result.decoded);
        setBase64Urls(result.urls);
        showToast("Pasted and decoded successfully!", "success");
      } catch {
        // Not valid Base64, just show pasted confirmation
        showToast("Pasted from clipboard!", "info");
      }
    } catch {
      setBase64Error("Could not access clipboard. Please paste manually.");
      showToast("Clipboard access denied", "error");
    }
  }

  const filteredXtreamChannels = useMemo(() => {
    const q = xtreamSearchDebounced.trim().toLowerCase();
    if (!q) return xtreamChannels;
    return xtreamChannels.filter((c) => c.name.toLowerCase().includes(q));
  }, [xtreamChannels, xtreamSearchDebounced]);

  const sortedXtreamChannels = useMemo(() => {
    const dir = xtreamChannelSortDir === "asc" ? 1 : -1;
    const next = filteredXtreamChannels.slice();
    next.sort((a, b) => {
      const aa = xtreamChannelSort === "id" ? a.id : a.name;
      const bb = xtreamChannelSort === "id" ? b.id : b.name;
      return aa.localeCompare(bb) * dir;
    });
    return next;
  }, [filteredXtreamChannels, xtreamChannelSort, xtreamChannelSortDir]);

  const filteredStalkerChannels = useMemo(() => {
    const q = stalkerSearchDebounced.trim().toLowerCase();
    if (!q) return stalkerChannels;
    return stalkerChannels.filter((c) => c.name.toLowerCase().includes(q));
  }, [stalkerChannels, stalkerSearchDebounced]);

  const sortedStalkerChannels = useMemo(() => {
    const dir = stalkerChannelSortDir === "asc" ? 1 : -1;
    const next = filteredStalkerChannels.slice();
    next.sort((a, b) => {
      const aa = stalkerChannelSort === "id" ? a.id : a.name;
      const bb = stalkerChannelSort === "id" ? b.id : b.name;
      return aa.localeCompare(bb) * dir;
    });
    return next;
  }, [filteredStalkerChannels, stalkerChannelSort, stalkerChannelSortDir]);

  const filteredXtreamCats = useMemo(() => {
    const q = xtreamCatSearch.trim().toLowerCase();
    if (!q) return xtreamCats;
    return xtreamCats.filter((c) => c.name.toLowerCase().includes(q));
  }, [xtreamCats, xtreamCatSearch]);

  const filteredStalkerGenres = useMemo(() => {
    const q = stalkerGenreSearch.trim().toLowerCase();
    if (!q) return stalkerGenres;
    return stalkerGenres.filter((g) => g.name.toLowerCase().includes(q));
  }, [stalkerGenres, stalkerGenreSearch]);

  function readPlaylistPrefs(): PlaylistPrefs {
    // Separate localStorage key to remember last selected category/genre per server.
    // This is intentionally separate from the main LS_KEY_V2 so resets are predictable.
    try {
      const raw = localStorage.getItem(LS_PLAYLIST_PREFS);
      if (!raw) return { xtream: {}, stalker: {} };
      const p = JSON.parse(raw);
      return {
        xtream: typeof p?.xtream === "object" && p?.xtream ? p.xtream : {},
        stalker: typeof p?.stalker === "object" && p?.stalker ? p.stalker : {},
      };
    } catch {
      return { xtream: {}, stalker: {} };
    }
  }

  function writePlaylistPrefs(next: PlaylistPrefs) {
    try {
      localStorage.setItem(LS_PLAYLIST_PREFS, JSON.stringify(next));
    } catch {
      // ignore
    }
  }

  function xtreamPrefKey(): string {
    try {
      const url = normalizeUrl(xtreamSingle.url);
      const username = xtreamSingle.username.trim();
      return `${url}|${username}`;
    } catch {
      return "";
    }
  }

  function stalkerPrefKey(): string {
    try {
      const url = normalizeStalkerUrl(stalkerSingle.url);
      const mac = normalizeMac(stalkerSingle.mac);
      return `${url}|${mac}`;
    } catch {
      return "";
    }
  }

  useEffect(() => {
    const t = setTimeout(() => setXtreamSearchDebounced(xtreamSearch), 200);
    return () => clearTimeout(t);
  }, [xtreamSearch]);

  useEffect(() => {
    const t = setTimeout(() => setStalkerSearchDebounced(stalkerSearch), 200);
    return () => clearTimeout(t);
  }, [stalkerSearch]);

  const resetPlaylistState = useCallback(() => {
    setPlaylistBusy(false);
    setPlaylistError("");
    setXtreamCats([]);
    setXtreamCatId("");
    setXtreamChannels([]);
    setXtreamSearch("");
    setXtreamSearchDebounced("");
    setXtreamCatSearch("");
    setCopiedXtreamStreamId("");
    setStalkerGenres([]);
    setStalkerChannels([]);
    setStalkerGenreId("");
    setStalkerSearch("");
    setStalkerSearchDebounced("");
    setStalkerGenreSearch("");
  }, []);

  useEffect(() => {
    resetPlaylistState();
  }, [mode, runMode, resetPlaylistState]);

  const showToast = useCallback((msg: string, type: "success" | "error" | "info" | "warning" = "info") => {
    setToast({ message: msg, type });
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 2500);
  }, []);

  async function loadXtreamCategories() {
    // Loads Xtream live categories. If we have a remembered categoryId for this server,
    // we auto-select it and immediately load channels to reduce clicks.
    setPlaylistError("");
    setPlaylistBusy(true);
    try {
      const url = normalizeUrl(xtreamSingle.url);
      const username = xtreamSingle.username.trim();
      const password = xtreamSingle.password.trim();

      const res = await fetch("/api/playlist/xtream", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-ZoneNew-Client": "1" },
        body: JSON.stringify({ url, username, password }),
      });
      const json: unknown = await res.json().catch(() => ({}));
      const obj = asObj(json);
      if (handleMaybeVerifyRequired(res, obj)) return;
      if (!res.ok || obj["ok"] !== true) throw new Error(typeof obj["error"] === "string" ? String(obj["error"]) : "Failed to load categories.");

      const cats = Array.isArray(obj["categories"]) ? (obj["categories"] as XtreamPlaylistCategory[]) : [];
      setXtreamCats(cats);
      setXtreamChannels([]);
      setXtreamCatId("");
      setXtreamSearch("");

      const key = xtreamPrefKey();
      if (key) {
        const prefs = readPlaylistPrefs();
        const last = prefs.xtream?.[key]?.lastCategoryId;
        if (last && cats.some((c) => c.id === last)) {
          setXtreamCatId(last);
          await loadXtreamChannels(last);
        }
      }
    } catch (e: unknown) {
      setPlaylistError(errMsg(e));
    } finally {
      setPlaylistBusy(false);
    }
  }

  async function loadXtreamChannels(categoryId: string) {
    // Loads live channels for a specific Xtream category.
    setPlaylistError("");
    setPlaylistBusy(true);
    try {
      const url = normalizeUrl(xtreamSingle.url);
      const username = xtreamSingle.username.trim();
      const password = xtreamSingle.password.trim();

      const res = await fetch("/api/playlist/xtream", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-ZoneNew-Client": "1" },
        body: JSON.stringify({ url, username, password, categoryId }),
      });
      const json: unknown = await res.json().catch(() => ({}));
      const obj = asObj(json);
      if (handleMaybeVerifyRequired(res, obj)) return;
      if (!res.ok || obj["ok"] !== true) throw new Error(typeof obj["error"] === "string" ? String(obj["error"]) : "Failed to load channels.");

      const chans = Array.isArray(obj["channels"]) ? (obj["channels"] as XtreamPlaylistChannel[]) : [];
      setXtreamChannels(chans);
      setXtreamSearch("");

      const key = xtreamPrefKey();
      if (key) {
        const prefs = readPlaylistPrefs();
        prefs.xtream[key] = { ...(prefs.xtream[key] || {}), lastCategoryId: categoryId };
        writePlaylistPrefs(prefs);
      }
    } catch (e: unknown) {
      setPlaylistError(errMsg(e));
    } finally {
      setPlaylistBusy(false);
    }
  }

  async function loadStalkerGenres() {
    // Loads Stalker genres. If we have a remembered genreId for this portal+MAC,
    // we auto-select it and load the first page.
    setPlaylistError("");
    setPlaylistBusy(true);
    try {
      const url = normalizeStalkerUrl(stalkerSingle.url);
      const mac = normalizeMac(stalkerSingle.mac);

      const res = await fetch("/api/playlist/stalker", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-ZoneNew-Client": "1" },
        body: JSON.stringify({ url, mac }),
      });
      const json: unknown = await res.json().catch(() => ({}));
      const obj = asObj(json);
      if (handleMaybeVerifyRequired(res, obj)) return;
      if (!res.ok || obj["ok"] !== true) throw new Error(typeof obj["error"] === "string" ? String(obj["error"]) : "Failed to load genres.");

      const genres = Array.isArray(obj["genres"]) ? (obj["genres"] as StalkerPlaylistGenre[]) : [];
      setStalkerGenres(genres);
      setStalkerChannels([]);
      setStalkerGenreId("");
      setStalkerSearch("");

      const key = stalkerPrefKey();
      if (key) {
        const prefs = readPlaylistPrefs();
        const last = prefs.stalker?.[key]?.lastGenreId;
        if (last && genres.some((g) => g.id === last)) {
          setStalkerGenreId(last);
          await loadStalkerChannels(last);
        }
      }
    } catch (e: unknown) {
      setPlaylistError(errMsg(e));
    } finally {
      setPlaylistBusy(false);
    }
  }

  async function loadStalkerChannels(genreId: string) {
    // Loads Stalker channels for a genre.
    // The API consolidates pagination server-side so the UI can show a single long list.
    setPlaylistError("");
    setPlaylistBusy(true);
    try {
      const url = normalizeStalkerUrl(stalkerSingle.url);
      const mac = normalizeMac(stalkerSingle.mac);

      const res = await fetch("/api/playlist/stalker", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-ZoneNew-Client": "1" },
        body: JSON.stringify({ url, mac, genreId, all: true }),
      });
      const json: unknown = await res.json().catch(() => ({}));
      const obj = asObj(json);
      if (handleMaybeVerifyRequired(res, obj)) return;
      if (!res.ok || obj["ok"] !== true) throw new Error(typeof obj["error"] === "string" ? String(obj["error"]) : "Failed to load channels.");

      const chans = Array.isArray(obj["channels"]) ? (obj["channels"] as StalkerPlaylistChannel[]) : [];
      startTransition(() => {
        setStalkerChannels(chans);
        setStalkerSearch("");
      });

      const key = stalkerPrefKey();
      if (key) {
        const prefs = readPlaylistPrefs();
        prefs.stalker[key] = { ...(prefs.stalker[key] || {}), lastGenreId: genreId };
        writePlaylistPrefs(prefs);
      }
    } catch (e: unknown) {
      setPlaylistError(errMsg(e));
    } finally {
      setPlaylistBusy(false);
    }
  }

  const xtreamSingleErrors = useMemo(() => {
    const errs: string[] = [];
    try {
      normalizeUrl(xtreamSingle.url);
    } catch (e: unknown) {
      errs.push(e instanceof Error ? e.message : "Invalid URL.");
    }
    if (!xtreamSingle.username.trim()) errs.push("Username is required.");
    if (!xtreamSingle.password.trim()) errs.push("Password is required.");
    return errs;
  }, [xtreamSingle.url, xtreamSingle.username, xtreamSingle.password]);

  const stalkerSingleErrors = useMemo(() => {
    const errs: string[] = [];
    try {
      normalizeStalkerUrl(stalkerSingle.url);
    } catch (e: unknown) {
      errs.push(e instanceof Error ? e.message : "Invalid URL.");
    }
    try {
      normalizeMac(stalkerSingle.mac);
    } catch (e: unknown) {
      errs.push(e instanceof Error ? e.message : "Invalid MAC.");
    }
    return errs;
  }, [stalkerSingle.url, stalkerSingle.mac]);

  const xtreamBulkSummary = useMemo(() => {
    const rawLines = (xtreamBulk.lines || "").split(/\r?\n/);
    let total = 0;
    let valid = 0;
    let invalid = 0;
    for (let i = 0; i < rawLines.length; i++) {
      const raw = rawLines[i].trim();
      if (!raw) continue;
      total++;
      try {
        parseXtreamFromUrlLine(raw);
        valid++;
      } catch {
        invalid++;
      }
    }
    return { total, valid, invalid };
  }, [xtreamBulk.lines]);

  const stalkerBulkSummary = useMemo(() => {
    const rawLines = (stalkerBulk.macs || "").split(/\r?\n/);
    let total = 0;
    let valid = 0;
    let invalid = 0;
    for (let i = 0; i < rawLines.length; i++) {
      const raw = rawLines[i].trim();
      if (!raw) continue;
      total++;
      try {
        normalizeMac(raw);
        valid++;
      } catch {
        invalid++;
      }
    }
    return { total, valid, invalid };
  }, [stalkerBulk.macs]);

  const stalkerBulkUrlError = useMemo(() => {
    try {
      normalizeStalkerUrl(stalkerBulk.url);
      return "";
    } catch (e: unknown) {
      return e instanceof Error ? e.message : "Invalid URL.";
    }
  }, [stalkerBulk.url]);

  const bulkDisabledReason = useMemo(() => {
    if (runMode !== "bulk") return "";
    if (mode === "xtream") {
      if (xtreamBulkSummary.total === 0) return "Paste at least 1 line.";
      if (xtreamBulkSummary.invalid > 0) return "Fix invalid lines first.";
      if (xtreamBulkSummary.total > 50) return "Too many lines (max 50).";
      return "";
    }

    if (stalkerBulkUrlError) return "Fix portal URL first.";
    if (stalkerBulkSummary.total === 0) return "Paste at least 1 MAC.";
    if (stalkerBulkSummary.invalid > 0) return "Fix invalid MACs first.";
    if (stalkerBulkSummary.total > 50) return "Too many lines (max 50).";
    return "";
  }, [mode, runMode, stalkerBulkSummary.total, stalkerBulkSummary.invalid, stalkerBulkUrlError, xtreamBulkSummary.total, xtreamBulkSummary.invalid]);

  async function runSingle() {
    setError("");
    setSingleResult(emptyResult());
    setBulkResults([]);

    setPlaylistBusy(false);
    resetPlaylistState();

    setBusy(true);
    try {
      if (mode === "xtream") {
        const url = normalizeUrl(xtreamSingle.url);
        const username = xtreamSingle.username.trim();
        const password = xtreamSingle.password.trim();

        const res = await fetch("/api/check/xtream", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-ZoneNew-Client": "1" },
          body: JSON.stringify({ url, username, password }),
        });
        const json: unknown = await res.json().catch(() => ({}));
        const obj = asObj(json);
        if (handleMaybeVerifyRequired(res, obj)) return;
        if (!res.ok || obj["ok"] !== true) throw new Error(typeof obj["error"] === "string" ? String(obj["error"]) : "Check failed.");

        setSingleResult({
          ok: true,
          expiryDate: String(obj["expiryDate"] ?? "N/A"),
          expiryTs: typeof obj["expiryTs"] === "number" ? (obj["expiryTs"] as number) : undefined,
          maxConnections: String(obj["maxConnections"] ?? "N/A"),
          activeConnections: String(obj["activeConnections"] ?? "N/A"),
          realUrl: String(obj["realUrl"] ?? "N/A"),
          port: String(obj["port"] ?? "N/A"),
          timezone: String(obj["timezone"] ?? "N/A"),
        });

        await loadXtreamCategories();
      } else {
        const url = normalizeStalkerUrl(stalkerSingle.url);
        const mac = normalizeMac(stalkerSingle.mac);

        const res = await fetch("/api/check/stalker", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-ZoneNew-Client": "1" },
          body: JSON.stringify({ url, mac }),
        });
        const json: unknown = await res.json().catch(() => ({}));
        const obj = asObj(json);
        if (handleMaybeVerifyRequired(res, obj)) return;
        if (!res.ok || obj["ok"] !== true) throw new Error(typeof obj["error"] === "string" ? String(obj["error"]) : "Check failed.");

        setSingleResult({
          ok: true,
          expiryDate: String(obj["expiryDate"] ?? "N/A"),
          expiryTs: typeof obj["expiryTs"] === "number" ? (obj["expiryTs"] as number) : undefined,
          maxConnections: String(obj["maxConnections"] ?? "N/A"),
          realUrl: String(obj["realUrl"] ?? "N/A"),
          port: String(obj["port"] ?? "N/A"),
          timezone: String(obj["timezone"] ?? "N/A"),
          portalIp: String(obj["portalIp"] ?? "N/A"),
          channels: String(obj["channels"] ?? "N/A"),
        });

        await loadStalkerGenres();
      }
    } catch (e: unknown) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function runBulk() {
    setError("");
    setSingleResult(emptyResult());
    setBulkResults([]);
    setBulkDone(0);
    setBulkTotal(0);

    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;

    setBusy(true);
    try {
      const CONCURRENCY = 5;

      if (mode === "xtream") {
        const rawLines = (xtreamBulk.lines || "").split(/\r?\n/);
        const parsed: { lineNumber: number; raw: string; url: string; username: string; password: string; rowIndex: number }[] = [];
        const outRows: BulkRowResult[] = [];

        for (let i = 0; i < rawLines.length; i++) {
          const raw = rawLines[i].trim();
          if (!raw) continue;
          const lineNumber = i + 1;
          const rowIndex = outRows.length;
          try {
            const { url, username, password } = parseXtreamFromUrlLine(raw);
            parsed.push({ lineNumber, raw, url, username, password, rowIndex });
            outRows.push({
              lineNumber,
              input: raw,
              result: { ok: false, error: "Checking...", expiryDate: "N/A", maxConnections: "N/A", realUrl: "N/A", port: "N/A", timezone: "N/A" },
            });
          } catch (e: unknown) {
            outRows.push({
              lineNumber,
              input: raw,
              result: {
                ok: false,
                error: e instanceof Error ? `Line ${lineNumber}: ${e.message}` : `Line ${lineNumber}: Invalid line`,
                expiryDate: "N/A",
                maxConnections: "N/A",
                realUrl: "N/A",
                port: "N/A",
                timezone: "N/A",
              },
            });
          }
        }

        if (parsed.length === 0 && outRows.length === 0) {
          throw new Error("Bulk input is empty.");
        }
        if (outRows.length > 50) {
          throw new Error("Too many lines. Max allowed: 50.");
        }

        setBulkTotal(parsed.length);
        setBulkResults(outRows);

        await runPool(parsed, CONCURRENCY, async (item: (typeof parsed)[number]) => {
          if (signal.aborted) return;

          try {
            const res = await fetch("/api/check/xtream", {
              method: "POST",
              headers: { "Content-Type": "application/json", "X-ZoneNew-Client": "1" },
              body: JSON.stringify({ url: item.url, username: item.username, password: item.password }),
              signal,
            });

            const json: unknown = await res.json().catch(() => ({}));
            const jsonObj = asObj(json);

            if (handleMaybeVerifyRequired(res, jsonObj)) return;

            if (!res.ok || jsonObj["ok"] !== true) {
              const err = typeof jsonObj["error"] === "string" ? String(jsonObj["error"]) : "Check failed.";
              setBulkResults((prev) => {
                const next = prev.slice();
                next[item.rowIndex] = {
                  lineNumber: item.lineNumber,
                  input: item.raw,
                  result: {
                    ok: false,
                    error: err,
                    expiryDate: "N/A",
                    expiryTs: undefined,
                    maxConnections: "N/A",
                    realUrl: "N/A",
                    port: "N/A",
                    timezone: "N/A",
                  },
                };
                return next;
              });
              return;
            }

            setBulkResults((prev) => {
              const next = prev.slice();
              next[item.rowIndex] = {
                lineNumber: item.lineNumber,
                input: item.raw,
                result: {
                  ok: true,
                  expiryDate: String(jsonObj["expiryDate"] ?? "N/A"),
                  expiryTs: typeof jsonObj["expiryTs"] === "number" ? (jsonObj["expiryTs"] as number) : undefined,
                  maxConnections: String(jsonObj["maxConnections"] ?? "N/A"),
                  realUrl: String(jsonObj["realUrl"] ?? "N/A"),
                  port: String(jsonObj["port"] ?? "N/A"),
                  timezone: String(jsonObj["timezone"] ?? "N/A"),
                },
              };
              return next;
            });
          } catch (e: unknown) {
            if (
              typeof e === "object" &&
              e !== null &&
              "name" in e &&
              (e as { name?: unknown }).name === "AbortError"
            ) {
              return;
            }

            const msg = errMsg(e);
            setBulkResults((prev) => {
              const next = prev.slice();
              next[item.rowIndex] = {
                lineNumber: item.lineNumber,
                input: item.raw,
                result: {
                  ok: false,
                  error: msg,
                  expiryDate: "N/A",
                  expiryTs: undefined,
                  maxConnections: "N/A",
                  realUrl: "N/A",
                  port: "N/A",
                  timezone: "N/A",
                },
              };
              return next;
            });
          } finally {
            if (!signal.aborted) setBulkDone((d) => d + 1);
          }
        });
      } else {
        const url = normalizeStalkerUrl(stalkerBulk.url);
        const rawLines = (stalkerBulk.macs || "").split(/\r?\n/);
        const parsed: { lineNumber: number; raw: string; mac: string; rowIndex: number }[] = [];
        const outRows: BulkRowResult[] = [];

        for (let i = 0; i < rawLines.length; i++) {
          const raw = rawLines[i].trim();
          if (!raw) continue;
          const lineNumber = i + 1;
          const rowIndex = outRows.length;
          try {
            const mac = normalizeMac(raw);
            parsed.push({ lineNumber, raw, mac, rowIndex });
            outRows.push({
              lineNumber,
              input: mac,
              result: {
                ok: false,
                error: "Checking...",
                expiryDate: "N/A",
                expiryTs: undefined,
                maxConnections: "N/A",
                realUrl: "N/A",
                port: "N/A",
                timezone: "N/A",
                portalIp: "N/A",
                channels: "N/A",
              },
            });
          } catch (e: unknown) {
            outRows.push({
              lineNumber,
              input: raw,
              result: {
                ok: false,
                error: e instanceof Error ? `Line ${lineNumber}: ${e.message}` : `Line ${lineNumber}: Invalid MAC`,
                expiryDate: "N/A",
                expiryTs: undefined,
                maxConnections: "N/A",
                realUrl: "N/A",
                port: "N/A",
                timezone: "N/A",
                portalIp: "N/A",
                channels: "N/A",
              },
            });
          }
        }

        if (parsed.length === 0 && outRows.length === 0) {
          throw new Error("Bulk input is empty.");
        }
        if (outRows.length > 50) {
          throw new Error("Too many lines. Max allowed: 50.");
        }

        setBulkTotal(parsed.length);
        setBulkResults(outRows);

        await runPool(parsed, CONCURRENCY, async (item: (typeof parsed)[number]) => {
          if (signal.aborted) return;

          try {
            const res = await fetch("/api/check/stalker", {
              method: "POST",
              headers: { "Content-Type": "application/json", "X-ZoneNew-Client": "1" },
              body: JSON.stringify({ url, mac: item.mac }),
              signal,
            });
            const json: unknown = await res.json().catch(() => ({}));
            const jsonObj = asObj(json);

            if (handleMaybeVerifyRequired(res, jsonObj)) return;

            if (!res.ok || jsonObj["ok"] !== true) {
              const err = typeof jsonObj["error"] === "string" ? String(jsonObj["error"]) : "Check failed.";
              setBulkResults((prev) => {
                const next = prev.slice();
                next[item.rowIndex] = {
                  lineNumber: item.lineNumber,
                  input: item.mac,
                  result: {
                    ok: false,
                    error: err,
                    expiryDate: "N/A",
                    expiryTs: undefined,
                    maxConnections: "N/A",
                    realUrl: "N/A",
                    port: "N/A",
                    timezone: "N/A",
                    portalIp: "N/A",
                    channels: "N/A",
                  },
                };
                return next;
              });
              return;
            }

            setBulkResults((prev) => {
              const next = prev.slice();
              next[item.rowIndex] = {
                lineNumber: item.lineNumber,
                input: item.mac,
                result: {
                  ok: true,
                  expiryDate: String(jsonObj["expiryDate"] ?? "N/A"),
                  expiryTs: typeof jsonObj["expiryTs"] === "number" ? (jsonObj["expiryTs"] as number) : undefined,
                  maxConnections: String(jsonObj["maxConnections"] ?? "N/A"),
                  realUrl: String(jsonObj["realUrl"] ?? "N/A"),
                  port: String(jsonObj["port"] ?? "N/A"),
                  timezone: String(jsonObj["timezone"] ?? "N/A"),
                  portalIp: String(jsonObj["portalIp"] ?? "N/A"),
                  channels: String(jsonObj["channels"] ?? "N/A"),
                },
              };
              return next;
            });
          } catch (e: unknown) {
            if (
              typeof e === "object" &&
              e !== null &&
              "name" in e &&
              (e as { name?: unknown }).name === "AbortError"
            ) {
              return;
            }

            const msg = errMsg(e);
            setBulkResults((prev) => {
              const next = prev.slice();
              next[item.rowIndex] = {
                lineNumber: item.lineNumber,
                input: item.mac,
                result: {
                  ok: false,
                  error: msg,
                  expiryDate: "N/A",
                  expiryTs: undefined,
                  maxConnections: "N/A",
                  realUrl: "N/A",
                  port: "N/A",
                  timezone: "N/A",
                  portalIp: "N/A",
                  channels: "N/A",
                },
              };
              return next;
            });
          } finally {
            if (!signal.aborted) setBulkDone((d) => d + 1);
          }
        });
      }
    } catch (e: unknown) {
      if (typeof e === "object" && e !== null && "name" in e && (e as { name?: unknown }).name === "AbortError") {
        setError("Stopped.");
      } else {
        setError(errMsg(e));
      }
    } finally {
      setBusy(false);
    }
  }

  function resetAll() {
    startTransition(() => {
      setError("");
      setSingleResult(emptyResult());
      setBulkResults([]);
      setBulkTotal(0);
      setBulkDone(0);
      setPlaylistBusy(false);
      resetPlaylistState();
      setXtreamSingle({ url: "", username: "", password: "" });
      setStalkerSingle({ url: "", mac: "" });
      setXtreamBulk({ lines: "" });
      setStalkerBulk({ url: "", macs: "" });
      setXtreamPlaylistTab("list");
      setStalkerPlaylistTab("list");
    });
    try {
      localStorage.removeItem(LS_KEY_V2);
      localStorage.removeItem(LS_KEY_V1);
    } catch {
      // ignore
    }
  }

  async function copyAll() {
    const payload = runMode === "single" ? singleResult : bulkResults;
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    } catch {
      // ignore
    }
  }

  return (
    <main className="container">
      <div className="brandHeader">
        <div className="brandBar">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="brandImg brandImgDesktop"
            src="https://i.ibb.co/0p8g1MYC/Zone-NEW-ICON-1000-x-320-px.png"
            alt="ZONE NEW"
            width={1000}
            height={320}
            decoding="async"
          />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="brandImg brandImgMobile"
            src="https://i.ibb.co/5hqtGGDW/Zone-NEW-ICON-1024-x-1024-px.png"
            alt="ZONE NEW"
            width={1024}
            height={1024}
            decoding="async"
          />
        </div>
      </div>

      <div className="header">
        <div>
          <div className="title">ZONE NEW CHECKER</div>
          <div className="subtitle">
            {mode === "base64" 
              ? "Decode Base64 strings and open paste.sh links. All processing happens in your browser."
              : <>Built for <a href="https://www.reddit.com/r/IPTV_ZONENEW/" target="_blank" rel="noreferrer">r/IPTV_ZONENEW</a>. Validate Xtream or Stalker (MAC). Stored only in your browser.</>
            }
          </div>
        </div>
        <span className="badge">{activeTitle}</span>
      </div>

      <div className="panel checkerPanel" data-mode={mode}>
        {/* Inline Turnstile Verification Widget */}
        {isVerified === false && siteKey && (
          <>
            <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer />
            <div className="verifyBanner">
              <div className="verifyBannerContent">
                <div className="verifyBannerText">
                  <strong>Human Verification Required</strong>
                  <span>Complete the challenge below to use all features. This helps protect the service from abuse.</span>
                </div>
                <div
                  className="cf-turnstile"
                  data-sitekey={siteKey}
                  data-theme="dark"
                  data-callback="onTurnstileSuccess"
                  data-error-callback="onTurnstileError"
                  data-expired-callback="onTurnstileExpired"
                  data-timeout-callback="onTurnstileTimeout"
                />
              </div>
              {turnstileError && <div className="verifyBannerError">{turnstileError}</div>}
              {verifying && <div className="verifyBannerLoading">Verifying...</div>}
            </div>
          </>
        )}

        <div className="checkerTop">
          <div className="checkerSelectors">
            <div className="segmented triple" aria-label="Provider" data-active={mode}>
              <span className="segmentedIndicator" aria-hidden="true" />
              <button
                type="button"
                data-active={mode === "xtream"}
                onClick={() => {
                  setMode("xtream");
                  setXtreamPlaylistTab("list");
                }}
                disabled={busy}
              >
                Xtream
              </button>
              <button
                type="button"
                data-active={mode === "stalker"}
                onClick={() => {
                  setMode("stalker");
                  setStalkerPlaylistTab("list");
                }}
                disabled={busy}
              >
                Stalker (MAC)
              </button>
              <button
                type="button"
                data-active={mode === "base64"}
                onClick={() => setMode("base64")}
                disabled={busy}
              >
                Base64
              </button>
            </div>

            {mode !== "base64" && (
              <div className="segmented" aria-label="Run mode" data-active={runMode === "single" ? "left" : "right"}>
                <span className="segmentedIndicator" aria-hidden="true" />
                <button type="button" data-active={runMode === "single"} onClick={() => setRunMode("single")} disabled={busy}>
                  Single
                </button>
                <button type="button" data-active={runMode === "bulk"} onClick={() => setRunMode("bulk")} disabled={busy}>
                  Bulk
                </button>
              </div>
            )}
          </div>

          {mode !== "base64" && (
            <div className="checkerActions">
              <button className="btn" onClick={copyAll} disabled={busy}>
                Copy
              </button>
              <button className="btn danger" onClick={resetAll} disabled={busy}>
                Reset
              </button>
            </div>
          )}
        </div>

        <div style={{ height: 12 }} />

            {mode === "xtream" && runMode === "single" && (
              <div className="row two">
                <div>
                  <label>URL</label>
                  <input value={xtreamSingle.url} onChange={(e) => setXtreamSingle({ ...xtreamSingle, url: e.target.value })} placeholder="http://domain.com:8080" />
                  {xtreamSingleErrors.length > 0 ? <div className="fieldError">{xtreamSingleErrors[0]}</div> : null}
                </div>
                <div />
                <div>
                  <label>USERNAME</label>
                  <input value={xtreamSingle.username} onChange={(e) => setXtreamSingle({ ...xtreamSingle, username: e.target.value })} placeholder="username" />
                  {xtreamSingleErrors.includes("Username is required.") ? <div className="fieldError">Username is required.</div> : null}
                </div>
                <div>
                  <label>PASSWORD</label>
                  <input value={xtreamSingle.password} onChange={(e) => setXtreamSingle({ ...xtreamSingle, password: e.target.value })} placeholder="password" />
                  {xtreamSingleErrors.includes("Password is required.") ? <div className="fieldError">Password is required.</div> : null}
                </div>
              </div>
            )}

            {mode === "stalker" && runMode === "single" && (
              <div className="row two">
                <div>
                  <label>URL</label>
                  <input value={stalkerSingle.url} onChange={(e) => setStalkerSingle({ ...stalkerSingle, url: e.target.value })} placeholder="http://domain.com:8080" />
                  {stalkerSingleErrors.length > 0 ? <div className="fieldError">{stalkerSingleErrors[0]}</div> : null}
                </div>
                <div />
                <div>
                  <label>MAC ADDRESS</label>
                  <input value={stalkerSingle.mac} onChange={(e) => setStalkerSingle({ ...stalkerSingle, mac: e.target.value })} placeholder="00:1A:2B:3C:4D:5E" />
                </div>
                <div />
              </div>
            )}

            {mode === "xtream" && runMode === "bulk" && (
              <div className="row">
                <div>
                  <label>BULK XTREAM URLS (one per line)</label>
                  <textarea
                    className="bulkTextarea"
                    value={xtreamBulk.lines}
                    onChange={(e) => setXtreamBulk({ ...xtreamBulk, lines: e.target.value })}
                    placeholder={
                      "http://domain.com:8080/get.php?username=user1&password=pass1&type=m3u_plus\n" +
                      "http://domain2.com:8080/get.php?username=user2&password=pass2&type=m3u_plus"
                    }
                  />
                </div>
                <div className="notice">
                  Max 50 lines per bulk run (safety). Lines: {xtreamBulkSummary.total} • Valid: {xtreamBulkSummary.valid} • Invalid: {xtreamBulkSummary.invalid}
                </div>
              </div>
            )}

            {mode === "stalker" && runMode === "bulk" && (
              <div className="row">
                <div>
                  <label>URL</label>
                  <input value={stalkerBulk.url} onChange={(e) => setStalkerBulk({ ...stalkerBulk, url: e.target.value })} placeholder="http://domain.com:8080" />
                  {stalkerBulkUrlError ? <div className="fieldError">{stalkerBulkUrlError}</div> : null}
                </div>
                <div>
                  <label>BULK MAC ADDRESSES (one per line)</label>
                  <textarea
                    className="bulkTextarea"
                    value={stalkerBulk.macs}
                    onChange={(e) => setStalkerBulk({ ...stalkerBulk, macs: e.target.value })}
                    placeholder={`00:1A:2B:3C:4D:5E
00:11:22:33:44:55`}
                  />
                </div>
                <div className="notice">
                  Max 50 lines per bulk run (safety). Lines: {stalkerBulkSummary.total} • Valid: {stalkerBulkSummary.valid} • Invalid: {stalkerBulkSummary.invalid}
                </div>
              </div>
            )}

            {mode === "base64" && (
              <div className="row" style={{ gap: 12 }}>
                <div>
                  <label htmlFor="base64-input">INPUT</label>
                  
                  {/* First-time user hint tooltip */}
                  {showHint && isFirstTimeUser && (
                    <div 
                      className="first-time-hint"
                      role="status"
                      aria-live="polite"
                      style={{
                        background: "linear-gradient(135deg, rgba(19, 141, 224, 0.15), rgba(99, 91, 255, 0.15))",
                        border: "1px solid rgba(19, 141, 224, 0.35)",
                        borderRadius: 8,
                        padding: "12px 16px",
                        marginBottom: 12,
                        fontSize: 13,
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 10,
                        animation: "fadeInSlide 0.3s ease-out"
                      }}
                    >
                      <span style={{ fontSize: 18 }}>💡</span>
                      <div>
                        <strong style={{ color: "var(--accent)" }}>Welcome!</strong>
                        <div style={{ marginTop: 4, opacity: 0.9 }}>
                          Paste a Base64 string here to decode it. 
                          It usually starts with <code style={{ background: "rgba(255,255,255,0.1)", padding: "2px 6px", borderRadius: 4 }}>aHR0</code> and ends with <code style={{ background: "rgba(255,255,255,0.1)", padding: "2px 6px", borderRadius: 4 }}>=</code>
                        </div>
                      </div>
                      <button 
                        onClick={() => setShowHint(false)}
                        style={{ 
                          marginLeft: "auto", 
                          background: "none", 
                          border: "none", 
                          color: "var(--muted)", 
                          cursor: "pointer",
                          fontSize: 16
                        }}
                        aria-label="Dismiss hint"
                      >
                        ×
                      </button>
                    </div>
                  )}
                  
                  {/* Type detection warning for wrong mode */}
                  {detectedType === "xtream" && (
                    <div 
                      className="type-warning"
                      role="alert"
                      style={{
                        background: "rgba(251, 191, 36, 0.1)",
                        border: "1px solid rgba(251, 191, 36, 0.3)",
                        borderRadius: 6,
                        padding: "8px 12px",
                        marginBottom: 8,
                        fontSize: 12,
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        color: "#fbbf24"
                      }}
                    >
                      <span>⚠️</span>
                      <span>This looks like an <strong>Xtream URL</strong>. <button onClick={() => setMode("xtream")} className="btn small" style={{ padding: "2px 8px", fontSize: 11 }}>Switch to Xtream mode</button></span>
                    </div>
                  )}
                  {detectedType === "stalker" && (
                    <div 
                      className="type-warning"
                      role="alert"
                      style={{
                        background: "rgba(251, 191, 36, 0.1)",
                        border: "1px solid rgba(251, 191, 36, 0.3)",
                        borderRadius: 6,
                        padding: "8px 12px",
                        marginBottom: 8,
                        fontSize: 12,
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        color: "#fbbf24"
                      }}
                    >
                      <span>⚠️</span>
                      <span>This looks like a <strong>Stalker URL</strong>. <button onClick={() => setMode("stalker")} className="btn small" style={{ padding: "2px 8px", fontSize: 11 }}>Switch to Stalker mode</button></span>
                    </div>
                  )}
                  
                  <textarea
                    id="base64-input"
                    className={`bulkTextarea base64-input-${validationStatus}`}
                    value={base64Input}
                    onChange={(e) => {
                      setBase64Input(e.target.value);
                      setHasInput(!!e.target.value.trim());
                    }}
                    onKeyDown={(e) => {
                      // Golden Rule #2: Keyboard shortcut - Ctrl+Enter to decode
                      if (e.ctrlKey && e.key === "Enter" && base64Input.trim()) {
                        e.preventDefault();
                        handleBase64Decode();
                      }
                    }}
                    placeholder="Paste Base64 here (starts with aHR0, ends with =)"
                    rows={4}
                    style={{ 
                      minHeight: 80,
                      // Color-coded validation borders
                      borderColor: validationStatus === "valid" 
                        ? "rgba(74, 222, 128, 0.6)" 
                        : validationStatus === "partial"
                        ? "rgba(251, 191, 36, 0.5)"
                        : validationStatus === "invalid" && hasInput
                        ? "rgba(248, 113, 113, 0.5)"
                        : undefined,
                      borderWidth: validationStatus !== "empty" ? "2px" : "1px",
                      transition: "border-color 0.2s ease, box-shadow 0.2s ease"
                    }}
                    autoFocus
                    aria-label="Base64 input field"
                    aria-describedby={base64Error ? "base64-error" : undefined}
                    aria-invalid={validationStatus === "invalid"}
                  />
                  
                  {/* Validation status indicator */}
                  {validationStatus !== "empty" && (
                    <div 
                      className="validation-indicator"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        marginTop: 6,
                        fontSize: 12,
                        color: validationStatus === "valid" 
                          ? "#4ade80" 
                          : validationStatus === "partial"
                          ? "#fbbf24"
                          : "#f87171"
                      }}
                      aria-live="polite"
                    >
                      {validationStatus === "valid" && (
                        <>
                          <span>✓</span>
                          <span>Valid Base64 - ready to decode</span>
                        </>
                      )}
                      {validationStatus === "partial" && (
                        <>
                          <span>◐</span>
                          <span>Almost there - check for missing characters</span>
                        </>
                      )}
                      {validationStatus === "invalid" && detectedType === "base64" && (
                        <>
                          <span>✗</span>
                          <span>Invalid Base64 - contains non-Base64 characters</span>
                        </>
                      )}
                    </div>
                  )}
                  
                  {base64Error ? <div id="base64-error" className="fieldError" role="alert">{base64Error}</div> : null}
                </div>

                {/* Empty state illustration */}
                {!hasInput && !base64Output && (
                  <div 
                    className="empty-state"
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      padding: "24px 16px",
                      opacity: 0.6,
                      fontSize: 13,
                      textAlign: "center"
                    }}
                    aria-hidden="true"
                  >
                    <div style={{ fontSize: 32, marginBottom: 8, opacity: 0.5 }}>🔐</div>
                    <div style={{ color: "var(--muted)" }}>Paste a Base64 string to decode</div>
                    <div style={{ fontSize: 11, marginTop: 4, opacity: 0.5 }}>or use Ctrl+V to paste</div>
                  </div>
                )}

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  {/* Golden Rule #8: Dynamic button reduces cognitive load
                      Shows "Paste" when empty, "Decode" when filled */}
                  {!hasInput ? (
                    <button
                      className="btn primary"
                      onClick={smartPasteAndDecode}
                      title="Paste from clipboard and auto-decode (Ctrl+V also works)"
                      aria-label="Paste from clipboard"
                    >
                      Paste
                    </button>
                  ) : (
                    <button
                      className="btn primary"
                      onClick={handleBase64Decode}
                      disabled={validationStatus !== "valid"}
                      title={validationStatus === "valid" ? "Decode Base64 (Ctrl+Enter shortcut)" : "Enter valid Base64 to decode"}
                      aria-label="Decode Base64"
                      aria-disabled={validationStatus !== "valid"}
                    >
                      Decode
                    </button>
                  )}
                  
                  {/* Golden Rule #6: Easy reversal - Clear button always available */}
                  <button
                    className="btn"
                    onClick={() => {
                      setBase64Input("");
                      setBase64Output("");
                      setBase64Error("");
                      setBase64Urls([]);
                      setHasInput(false);
                      showToast("Cleared", "info");
                    }}
                    disabled={!hasInput && !base64Output}
                    title="Clear all fields"
                    aria-label="Clear all fields"
                  >
                    Clear
                  </button>
                </div>

                {base64Output && (
                  <div style={{ marginTop: 4 }}>
                    <label>DECODED</label>
                    <textarea
                      className="bulkTextarea"
                      value={base64Output}
                      readOnly
                      rows={3}
                      style={{ background: "rgba(255,255,255,0.05)", minHeight: 60 }}
                    />

                    {/* Extracted URLs - Compact Display */}
                    {base64Urls.length > 0 && (
                      <div style={{ marginTop: 8 }}>
                        <div style={{ 
                          fontSize: 11, 
                          color: "var(--accent)", 
                          marginBottom: 6, 
                          textTransform: "uppercase",
                          display: "flex",
                          flexWrap: "wrap",
                          gap: "8px 16px",
                          alignItems: "center"
                        }}>
                          <span>URL{base64Urls.length > 1 ? "S" : ""} FOUND</span>
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                          {base64Urls.map((url, idx) => (
                            <div
                              key={idx}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                                padding: "6px 10px",
                                background: "rgba(100,200,255,0.08)",
                                border: "1px solid rgba(100,200,255,0.2)",
                                borderRadius: 6,
                              }}
                            >
                              <span style={{ flex: 1, fontSize: 12, wordBreak: "break-all" }}>{url}</span>
                              <button
                                className="btn small"
                                onClick={() => {
                                  navigator.clipboard.writeText(url);
                                  showToast("URL copied!", "success");
                                }}
                              >
                                Copy
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                      <button
                        className="btn small"
                        onClick={() => {
                          navigator.clipboard.writeText(base64Output);
                          showToast("Copied!", "success");
                        }}
                      >
                        Copy Output
                      </button>
                      {base64Urls.length > 0 && (
                        <button
                          className="btn primary small"
                          onClick={() => openInPasteSh(base64Urls[0])}
                          title="Open paste.sh URL in new tab"
                        >
                          Open URL
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div style={{ height: 12 }} />

            {/* Controls - Check button only for Xtream/Stalker modes (not Base64) */}
            {mode !== "base64" && (
            <div className="controls">
              {runMode === "single" ? (
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <button
                    className="btn primary"
                    onClick={runSingle}
                    disabled={
                      busy ||
                      (mode === "xtream" ? xtreamSingleErrors.length > 0 : stalkerSingleErrors.length > 0)
                    }
                  >
                    {busy ? "Checking..." : "Check"}
                  </button>
                </div>
              ) : (
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <button className="btn primary" onClick={runBulk} disabled={busy || Boolean(bulkDisabledReason)}>
                    {busy ? "Checking..." : "Check (Bulk)"}
                  </button>
                  <button className="btn danger" onClick={stopBulk} disabled={!busy}>
                    Stop
                  </button>
                  {bulkDisabledReason ? <div className="fieldError">{bulkDisabledReason}</div> : null}
                </div>
              )}
            </div>
            )}

            {mode !== "base64" && runMode === "bulk" && (bulkTotal > 0 || busy) ? (
              <div className="progressRow">
                <div className="progressBar" aria-label="Progress">
                  <div className="progressFill" style={{ width: `${bulkTotal ? Math.min(100, Math.round((bulkDone / bulkTotal) * 100)) : 0}%` }} />
                </div>
                <div className="small">{bulkDone}/{bulkTotal || 0}</div>
              </div>
            ) : null}

        {error ? <div style={{ marginTop: 12 }} className="error">{error}</div> : null}
        {canShowSingle && playlistError ? <div style={{ marginTop: 12 }} className="error">{playlistError}</div> : null}
      </div>

      <div style={{ height: 16 }} />

      {canShowSingle && singleResult.ok ? (
        <div className="panel">
          <ResultKV label="EXPIRY DATE" value={singleResult.expiryDate} />
          {mode === "xtream" ? <ResultKV label="MAX CONNECTIONS" value={singleResult.maxConnections} /> : null}
          {mode === "xtream" ? <ResultKV label="ACTIVE CONNECTIONS" value={singleResult.activeConnections || "N/A"} /> : null}
          <ResultKV label="REAL URL" value={singleResult.realUrl} />
          <ResultKV label="PORT" value={singleResult.port} />
          <ResultKV label="TIMEZONE" value={singleResult.timezone} />
          {mode === "stalker" ? <ResultKV label="PORTAL IP" value={singleResult.portalIp || "N/A"} /> : null}
          {mode === "stalker" ? <ResultKV label="CHANNELS" value={singleResult.channels || "N/A"} /> : null}
        </div>
      ) : null}

      {canShowSingle && mode === "xtream" && (xtreamCats.length > 0 || xtreamChannels.length > 0) ? (
        <div className="panel">
          <div className="playlistHeader">
            <div>
              <div className="playlistTitle">Playlist Viewer</div>
              <div className="playlistSub">No playback. Select a category to load channels.</div>
            </div>
            <div className="small">{playlistBusy ? "Loading..." : ""}</div>
          </div>

          <div className="playlistTabs" aria-label="Playlist panes">
            <button type="button" className="playlistTab" data-active={xtreamPlaylistTab === "list"} onClick={() => setXtreamPlaylistTab("list")}>
              Categories
            </button>
            <button type="button" className="playlistTab" data-active={xtreamPlaylistTab === "channels"} onClick={() => setXtreamPlaylistTab("channels")}>
              Channels
            </button>
          </div>

          <div className="playlistGrid">
            <div className="playlistPane" data-mobile-hidden={xtreamPlaylistTab !== "list" ? "true" : "false"}>
              <div className="playlistPaneHeader">
                <div className="playlistPaneTitle">Categories</div>
                <div className="small">{xtreamCats.length}</div>
              </div>
              <div className="playlistControls">
                <input
                  value={xtreamCatSearch}
                  onChange={(e) => setXtreamCatSearch(e.target.value)}
                  placeholder={xtreamCats.length ? "Search categories..." : "Categories will appear after check"}
                  disabled={!xtreamCats.length}
                />
              </div>
              <div className="scrollArea padded" style={{ height: xtreamListHeight }}>
                {xtreamCats.length === 0 ? (
                  <div className="notice">
                    {playlistBusy ? "Loading categories..." : singleResult.ok ? "Checked OK — loading categories..." : "Run Check to load categories."}
                  </div>
                ) : null}
                <div className="listStack">
                  {filteredXtreamCats.map((c) => (
                    <button
                      key={c.id}
                      className="listBtn"
                      data-active={xtreamCatId === c.id}
                      onClick={() => {
                        setXtreamCatId(c.id);
                        loadXtreamChannels(c.id);
                      }}
                      disabled={playlistBusy}
                      title={c.name}
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="playlistPane" data-mobile-hidden={xtreamPlaylistTab !== "channels" ? "true" : "false"}>
              <div className="playlistPaneHeader">
                <div className="playlistPaneTitle">Channels</div>
                <div className="playlistPaneActions">
                  {xtreamCatId ? (
                    <button
                      className="btn"
                      onClick={() => {
                        setXtreamCatId("");
                        setXtreamChannels([]);
                        setXtreamSearch("");
                      }}
                      disabled={playlistBusy}
                    >
                      Clear
                    </button>
                  ) : null}
                  <div className="small">{xtreamCatId ? filteredXtreamChannels.length : 0}</div>
                </div>
              </div>
              <div className="playlistControls">
                <div className="playlistControlsRow">
                  <input
                    value={xtreamSearch}
                    onChange={(e) => {
                      const v = e.target.value;
                      startTransition(() => setXtreamSearch(v));
                    }}
                    placeholder={xtreamCatId ? "Search channels..." : "Select a category first"}
                    disabled={!xtreamCatId}
                  />
                  <select
                    className="miniSelect"
                    value={`${xtreamChannelSort}:${xtreamChannelSortDir}`}
                    onChange={(e) => {
                      const [k, d] = String(e.target.value).split(":");
                      if (k === "name" || k === "id") setXtreamChannelSort(k);
                      if (d === "asc" || d === "desc") setXtreamChannelSortDir(d);
                    }}
                    disabled={!xtreamCatId}
                    aria-label="Sort channels"
                  >
                    <option value="name:asc">Name (A→Z)</option>
                    <option value="name:desc">Name (Z→A)</option>
                    <option value="id:asc">ID (Asc)</option>
                    <option value="id:desc">ID (Desc)</option>
                  </select>
                </div>
              </div>

              {!xtreamCatId ? (
                <div className="notice">
                  {xtreamCats.length ? "Checked OK — select a category to load channels." : "Run Check to load playlist."}
                </div>
              ) : null}
              {xtreamCatId && xtreamChannels.length === 0 && !playlistBusy ? <div className="notice">No channels found.</div> : null}
              {xtreamCatId ? (
                <VirtualList
                  className="scrollArea"
                  items={sortedXtreamChannels}
                  itemHeight={64}
                  height={xtreamListHeight}
                  render={(ch: XtreamPlaylistChannel) => (
                    <div key={ch.id} className="channelRow channelRowWithAction">
                      <div className="channelLogo">
                        {ch.logo ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={logoSrc(ch.logo)}
                            alt=""
                            width={36}
                            height={36}
                            loading="lazy"
                            referrerPolicy="no-referrer"
                            onError={(e) => {
                              e.currentTarget.style.display = "none";
                            }}
                          />
                        ) : null}
                      </div>
                      <div className="channelName" title={ch.name}>
                        {ch.name}
                      </div>
                      <div className="channelActions">
                        <div
                          className="iconBtnWrap"
                          onMouseEnter={() => {
                            try {
                              const origin = normalizeUrl(xtreamSingle.url);
                              const username = xtreamSingle.username.trim();
                              const password = xtreamSingle.password.trim();
                              const streamId = ch.id.trim();
                              if (!origin || !username || !password || !streamId) return;
                              const streamUrl = `${origin}/live/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${encodeURIComponent(streamId)}.ts`;
                              setXtreamHoverUrl(streamUrl);
                            } catch {
                              // ignore
                            }
                          }}
                          onMouseLeave={() => setXtreamHoverUrl("")}
                        >
                          <button
                            type="button"
                            className="iconBtn vlc"
                            data-copied={copiedXtreamStreamId === ch.id ? "true" : "false"}
                            data-tooltip={xtreamHoverUrl || ""}
                            onClick={async () => {
                              try {
                                const origin = normalizeUrl(xtreamSingle.url);
                                const username = xtreamSingle.username.trim();
                                const password = xtreamSingle.password.trim();
                                const streamId = ch.id.trim();
                                if (!origin || !username || !password || !streamId) throw new Error("Missing URL/username/password or stream id.");

                                const streamUrl = `${origin}/live/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${encodeURIComponent(streamId)}.ts`;

                                if (navigator.clipboard?.writeText) {
                                  await navigator.clipboard.writeText(streamUrl);
                                } else {
                                  const ta = document.createElement("textarea");
                                  ta.value = streamUrl;
                                  ta.style.position = "fixed";
                                  ta.style.left = "-9999px";
                                  document.body.appendChild(ta);
                                  ta.focus();
                                  ta.select();
                                  document.execCommand("copy");
                                  document.body.removeChild(ta);
                                }

                                setCopiedXtreamStreamId(streamId);
                                showToast("Copied Stream Link", "success");
                                window.setTimeout(() => {
                                  setCopiedXtreamStreamId((cur) => (cur === streamId ? "" : cur));
                                }, 1500);
                              } catch (e: unknown) {
                                setError(errMsg(e));
                              }
                            }}
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                              <path
                                d="M10 13a5 5 0 0 0 7.07 0l2.83-2.83a5 5 0 0 0-7.07-7.07L11.5 4.43"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                              <path
                                d="M14 11a5 5 0 0 0-7.07 0L4.1 13.83a5 5 0 0 0 7.07 7.07L12.5 19.57"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                />
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {canShowSingle && mode === "stalker" && (stalkerGenres.length > 0 || stalkerChannels.length > 0) ? (
        <div className="panel">
          <div className="playlistHeader">
            <div>
              <div className="playlistTitle">Playlist Viewer</div>
              <div className="playlistSub">No playback. Select a genre to load channels.</div>
            </div>
            <div className="small">{playlistBusy ? "Loading..." : ""}</div>
          </div>

          <div className="playlistTabs" aria-label="Playlist panes">
            <button type="button" className="playlistTab" data-active={stalkerPlaylistTab === "list"} onClick={() => setStalkerPlaylistTab("list")}>
              Genres
            </button>
            <button type="button" className="playlistTab" data-active={stalkerPlaylistTab === "channels"} onClick={() => setStalkerPlaylistTab("channels")}>
              Channels
            </button>
          </div>

          <div className="playlistGrid">
            <div className="playlistPane" data-mobile-hidden={stalkerPlaylistTab !== "list" ? "true" : "false"}>
              <div className="playlistPaneHeader">
                <div className="playlistPaneTitle">Genres</div>
                <div className="small">{stalkerGenres.length}</div>
              </div>
              <div className="playlistControls">
                <input
                  value={stalkerGenreSearch}
                  onChange={(e) => {
                    const v = e.target.value;
                    startTransition(() => setStalkerGenreSearch(v));
                  }}
                  placeholder={stalkerGenres.length ? "Search genres..." : "Genres will appear after check"}
                  disabled={!stalkerGenres.length}
                />
              </div>
              <div className="scrollArea padded" style={{ height: xtreamListHeight }}>
                {stalkerGenres.length === 0 ? (
                  <div className="notice">
                    {playlistBusy ? "Loading genres..." : singleResult.ok ? "Checked OK — loading genres..." : "Run Check to load genres."}
                  </div>
                ) : null}
                <div className="listStack">
                  {filteredStalkerGenres.map((g) => (
                    <button
                      key={g.id}
                      className="listBtn"
                      data-active={stalkerGenreId === g.id}
                      onClick={() => {
                        setStalkerGenreId(g.id);
                        loadStalkerChannels(g.id);
                      }}
                      disabled={playlistBusy}
                      title={g.name}
                    >
                      {g.name}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="playlistPane" data-mobile-hidden={stalkerPlaylistTab !== "channels" ? "true" : "false"}>
              <div className="playlistPaneHeader">
                <div className="playlistPaneTitle">Channels</div>
                <div className="playlistPaneActions">
                  {stalkerGenreId ? (
                    <button
                      className="btn"
                      onClick={() => {
                        setStalkerGenreId("");
                        setStalkerChannels([]);
                        setStalkerSearch("");
                      }}
                      disabled={playlistBusy}
                    >
                      Clear
                    </button>
                  ) : null}
                  <div className="small">{stalkerGenreId ? filteredStalkerChannels.length : 0}</div>
                </div>
              </div>
              <div className="playlistControls">
                <div className="playlistControlsRow">
                  <input
                    value={stalkerSearch}
                    onChange={(e) => {
                      const v = e.target.value;
                      startTransition(() => setStalkerSearch(v));
                    }}
                    placeholder={stalkerGenreId ? "Search channels..." : "Select a genre first"}
                    disabled={!stalkerGenreId}
                  />
                  <select
                    className="miniSelect"
                    value={`${stalkerChannelSort}:${stalkerChannelSortDir}`}
                    onChange={(e) => {
                      const [k, d] = String(e.target.value).split(":");
                      if (k === "name" || k === "id") setStalkerChannelSort(k);
                      if (d === "asc" || d === "desc") setStalkerChannelSortDir(d);
                    }}
                    disabled={!stalkerGenreId}
                    aria-label="Sort channels"
                  >
                    <option value="name:asc">Name (A→Z)</option>
                    <option value="name:desc">Name (Z→A)</option>
                    <option value="id:asc">ID (Asc)</option>
                    <option value="id:desc">ID (Desc)</option>
                  </select>
                </div>
              </div>

              {!stalkerGenreId ? (
                <div className="notice">
                  {stalkerGenres.length ? "Checked OK — select a genre to load channels." : "Run Check to load playlist."}
                </div>
              ) : null}
              {stalkerGenreId && stalkerChannels.length === 0 && !playlistBusy ? <div className="notice">No channels found.</div> : null}
              {stalkerGenreId ? (
                <VirtualList
                  className="scrollArea"
                  items={sortedStalkerChannels}
                  itemHeight={64}
                  height={xtreamListHeight}
                  render={(ch: StalkerPlaylistChannel) => (
                    <div key={ch.id} className="channelRow">
                      <div className="channelLogo">
                        {ch.logo ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={logoSrc(ch.logo)}
                            alt=""
                            width={36}
                            height={36}
                            loading="lazy"
                            referrerPolicy="no-referrer"
                            onError={(e) => {
                              e.currentTarget.style.display = "none";
                            }}
                          />
                        ) : null}
                      </div>
                      <div className="channelName" title={ch.name}>
                        {ch.name}
                      </div>
                    </div>
                  )}
                />
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {runMode === "bulk" && bulkResults.length > 0 ? (
        <div className="panel">
          <div className="tableWrap">
            <table className="table">
              <thead>
                <tr>
                  <th>
                    <button className="thBtn" type="button" disabled={busy} onClick={() => toggleBulkSort("input")}>
                      Input <span className="thIcon">{sortIndicator("input")}</span>
                    </button>
                  </th>
                  <th>
                    <button className="thBtn" type="button" disabled={busy} onClick={() => toggleBulkSort("status")}>
                      Status <span className="thIcon">{sortIndicator("status")}</span>
                    </button>
                  </th>
                  <th>
                    <button className="thBtn" type="button" disabled={busy} onClick={() => toggleBulkSort("expiry")}>
                      Expiry <span className="thIcon">{sortIndicator("expiry")}</span>
                    </button>
                  </th>
                  <th>
                    <button className="thBtn" type="button" disabled={busy} onClick={() => toggleBulkSort("maxConnections")}>
                      Max <span className="thIcon">{sortIndicator("maxConnections")}</span>
                    </button>
                  </th>
                  <th>
                    <button className="thBtn" type="button" disabled={busy} onClick={() => toggleBulkSort("timezone")}>
                      Timezone <span className="thIcon">{sortIndicator("timezone")}</span>
                    </button>
                  </th>
                  {mode === "stalker" ? (
                    <th>
                      <button className="thBtn" type="button" disabled={busy} onClick={() => toggleBulkSort("portalIp")}>
                        Portal IP <span className="thIcon">{sortIndicator("portalIp")}</span>
                      </button>
                    </th>
                  ) : null}
                  {mode === "stalker" ? (
                    <th>
                      <button className="thBtn" type="button" disabled={busy} onClick={() => toggleBulkSort("channels")}>
                        Channels <span className="thIcon">{sortIndicator("channels")}</span>
                      </button>
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {sortedBulkResults.map((r, idx) => (
                  <tr key={`${r.lineNumber ?? idx}-${r.input}`}>
                    <td className="cellInput mono" title={r.input}>
                      <span className="cellTrunc">{r.input}</span>
                    </td>
                    <td>{r.result.ok ? "OK" : r.result.error || "Failed"}</td>
                    <td>{r.result.expiryDate}</td>
                    <td>{r.result.maxConnections}</td>
                    <td>{r.result.timezone}</td>
                    {mode === "stalker" ? <td className="mono">{r.result.portalIp || "N/A"}</td> : null}
                    {mode === "stalker" ? <td>{r.result.channels || "N/A"}</td> : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div className="footerHint">
        <div className="footerGroup">
          <a
            className="footerLink"
            href="https://github.com/iptv-org/awesome-iptv"
            target="_blank"
            rel="noreferrer"
          >
            Resources
          </a>
          <span className="small">|</span>
          <a className="footerLink" href="https://github.com/kidpoleon/zone-new-checker" target="_blank" rel="noreferrer">
            GitHub
          </a>
          <span className="small">|</span>
          <a
            className="footerLink"
            href="https://tally.so/r/NpXOKb"
            target="_blank"
            rel="noreferrer noopener"
          >
            Feedback
          </a>
        </div>
      </div>

      {toast ? (
        <div 
          className={`toast toast-${toast.type}`}
          role="status"
          aria-live="polite"
        >
          {toast.type === "success" && <span style={{ marginRight: 6 }}>✓</span>}
          {toast.type === "error" && <span style={{ marginRight: 6 }}>✗</span>}
          {toast.type === "warning" && <span style={{ marginRight: 6 }}>⚠</span>}
          {toast.type === "info" && <span style={{ marginRight: 6 }}>ℹ</span>}
          {toast.message}
        </div>
      ) : null}

      <div style={{ height: 16 }} />
    </main>
  );
}
