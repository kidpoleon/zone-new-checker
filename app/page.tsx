"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  render,
  className,
}: {
  items: T[];
  itemHeight: number;
  height: number;
  render: (item: T, idx: number) => JSX.Element;
  className?: string;
}) {
  // Minimal virtualization for fast scrolling through large channel lists.
  // We only render the visible window + overscan items to keep the UI responsive.
  const [scrollTop, setScrollTop] = useState(0);
  const total = items.length;
  const overscan = 8;
  const start = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
  const visibleCount = Math.ceil(height / itemHeight) + overscan * 2;
  const end = Math.min(total, start + visibleCount);
  const offsetY = start * itemHeight;

  return (
    <div
      className={className}
      style={{ height, overflow: "auto" }}
      onScroll={(e) => {
        setScrollTop(e.currentTarget.scrollTop);
      }}
    >
      <div style={{ height: total * itemHeight, position: "relative" }}>
        <div style={{ position: "absolute", top: offsetY, left: 0, right: 0, display: "grid", gap: 8 }}>
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

export default function HomePage() {
  const [mode, setMode] = useState<Mode>("xtream");
  const [runMode, setRunMode] = useState<RunMode>("single");

  const [xtreamSingle, setXtreamSingle] = useState<XtreamSingleState>({ url: "", username: "", password: "" });
  const [stalkerSingle, setStalkerSingle] = useState<StalkerSingleState>({ url: "", mac: "" });

  const [xtreamBulk, setXtreamBulk] = useState<XtreamBulkState>({ lines: "" });
  const [stalkerBulk, setStalkerBulk] = useState<StalkerBulkState>({ url: "", macs: "" });

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

  const [stalkerGenres, setStalkerGenres] = useState<StalkerPlaylistGenre[]>([]);
  const [stalkerGenreId, setStalkerGenreId] = useState<string>("");
  const [stalkerChannels, setStalkerChannels] = useState<StalkerPlaylistChannel[]>([]);
  const [stalkerSearch, setStalkerSearch] = useState<string>("");
  const [stalkerGenreSearch, setStalkerGenreSearch] = useState<string>("");
  const [stalkerPage, setStalkerPage] = useState<number>(0);
  const [stalkerHasMore, setStalkerHasMore] = useState<boolean>(false);

  const [xtreamSearchDebounced, setXtreamSearchDebounced] = useState<string>("");
  const [stalkerSearchDebounced, setStalkerSearchDebounced] = useState<string>("");

  const [viewportH, setViewportH] = useState<number>(0);

  const canShowSingle = runMode === "single";

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
      if (parsed?.mode) setMode(parsed.mode);
      if (parsed?.runMode) setRunMode(parsed.runMode);
      if (parsed?.xtreamSingle) setXtreamSingle(parsed.xtreamSingle);
      if (parsed?.stalkerSingle) setStalkerSingle(parsed.stalkerSingle);
      if (parsed?.xtreamBulk) setXtreamBulk(parsed.xtreamBulk);
      if (parsed?.stalkerBulk) setStalkerBulk(parsed.stalkerBulk);
      if (parsed?.singleResult) setSingleResult(parsed.singleResult);
      if (parsed?.bulkResults) setBulkResults(parsed.bulkResults);

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

  function clearResults() {
    setError("");
    setSingleResult(emptyResult());
    setBulkResults([]);
    setBulkTotal(0);
    setBulkDone(0);
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
  }

  function sortIndicator(key: BulkSortKey): string {
    if (!bulkSort || bulkSort.key !== key) return "";
    return bulkSort.dir === "asc" ? "↑" : "↓";
  }

  const filteredXtreamChannels = useMemo(() => {
    const q = xtreamSearchDebounced.trim().toLowerCase();
    if (!q) return xtreamChannels;
    return xtreamChannels.filter((c) => c.name.toLowerCase().includes(q));
  }, [xtreamChannels, xtreamSearchDebounced]);

  const filteredStalkerChannels = useMemo(() => {
    const q = stalkerSearchDebounced.trim().toLowerCase();
    if (!q) return stalkerChannels;
    return stalkerChannels.filter((c) => c.name.toLowerCase().includes(q));
  }, [stalkerChannels, stalkerSearchDebounced]);

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
    setPlaylistError("");
    setXtreamCats([]);
    setXtreamCatId("");
    setXtreamChannels([]);
    setXtreamSearch("");
    setXtreamSearchDebounced("");
    setXtreamCatSearch("");
    setStalkerGenres([]);
    setStalkerGenreId("");
    setStalkerChannels([]);
    setStalkerSearch("");
    setStalkerSearchDebounced("");
    setStalkerGenreSearch("");
    setStalkerPage(0);
    setStalkerHasMore(false);
  }, []);

  useEffect(() => {
    resetPlaylistState();
  }, [mode, runMode, resetPlaylistState]);

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
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json?.error || "Failed to load categories.");

      const cats = Array.isArray(json.categories) ? (json.categories as XtreamPlaylistCategory[]) : [];
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
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json?.error || "Failed to load channels.");

      const chans = Array.isArray(json.channels) ? (json.channels as XtreamPlaylistChannel[]) : [];
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
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json?.error || "Failed to load genres.");

      const genres = Array.isArray(json.genres) ? (json.genres as StalkerPlaylistGenre[]) : [];
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
          setStalkerPage(0);
          await loadStalkerChannels(last, 0, false);
        }
      }
    } catch (e: unknown) {
      setPlaylistError(errMsg(e));
    } finally {
      setPlaylistBusy(false);
    }
  }

  async function loadStalkerChannels(genreId: string, page: number, append: boolean) {
    // Loads paginated Stalker channels.
    // Stalker portals can have huge lists; we keep pagination and a debounced search UI.
    setPlaylistError("");
    setPlaylistBusy(true);
    try {
      const url = normalizeStalkerUrl(stalkerSingle.url);
      const mac = normalizeMac(stalkerSingle.mac);

      const res = await fetch("/api/playlist/stalker", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-ZoneNew-Client": "1" },
        body: JSON.stringify({ url, mac, genreId, page }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json?.error || "Failed to load channels.");

      const chans = Array.isArray(json.channels) ? (json.channels as StalkerPlaylistChannel[]) : [];
      setStalkerChannels((prev) => (append ? prev.concat(chans) : chans));
      if (!append) setStalkerSearch("");
      setStalkerPage(Number(json.page ?? page) || 0);
      setStalkerHasMore(Boolean(json.hasMore));

      if (!append) {
        const key = stalkerPrefKey();
        if (key) {
          const prefs = readPlaylistPrefs();
          prefs.stalker[key] = { ...(prefs.stalker[key] || {}), lastGenreId: genreId };
          writePlaylistPrefs(prefs);
        }
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
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json?.error || "Check failed.");

        setSingleResult({
          ok: true,
          expiryDate: json.expiryDate,
          expiryTs: typeof json.expiryTs === "number" ? json.expiryTs : undefined,
          maxConnections: String(json.maxConnections ?? "N/A"),
          realUrl: String(json.realUrl ?? "N/A"),
          port: String(json.port ?? "N/A"),
          timezone: String(json.timezone ?? "N/A"),
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
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json?.error || "Check failed.");

        setSingleResult({
          ok: true,
          expiryDate: String(json.expiryDate ?? "N/A"),
          expiryTs: typeof json.expiryTs === "number" ? json.expiryTs : undefined,
          maxConnections: String(json.maxConnections ?? "N/A"),
          realUrl: String(json.realUrl ?? "N/A"),
          port: String(json.port ?? "N/A"),
          timezone: String(json.timezone ?? "N/A"),
          portalIp: String(json.portalIp ?? "N/A"),
          channels: String(json.channels ?? "N/A"),
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

            const json: unknown = await res.json();
            const jsonObj = typeof json === "object" && json !== null ? (json as Record<string, unknown>) : {};

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
            const json: unknown = await res.json();
            const jsonObj = typeof json === "object" && json !== null ? (json as Record<string, unknown>) : {};

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
          />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="brandImg brandImgMobile"
            src="https://i.ibb.co/5hqtGGDW/Zone-NEW-ICON-1024-x-1024-px.png"
            alt="ZONE NEW"
          />
        </div>
      </div>

      <div className="header">
        <div>
          <div className="title">ZONE NEW CHECKER</div>
          <div className="subtitle">
            Built for <a href="https://www.reddit.com/r/IPTV_ZONENEW/" target="_blank" rel="noreferrer">r/IPTV_ZONENEW</a>. Validate Xtream or Stalker (MAC). Stored only in your browser.
          </div>
        </div>
        <span className="badge">{activeTitle}</span>
      </div>

      <div className="panel">
        <div className="controls">
          <div className="segment" aria-label="Mode">
            <button data-active={mode === "xtream"} onClick={() => setMode("xtream")} disabled={busy}>
              Xtream
            </button>
            <button data-active={mode === "stalker"} onClick={() => setMode("stalker")} disabled={busy}>
              Stalker (MAC)
            </button>
          </div>

          <div className="segment" aria-label="Run mode">
            <button data-active={runMode === "single"} onClick={() => setRunMode("single")} disabled={busy}>
              Single
            </button>
            <button data-active={runMode === "bulk"} onClick={() => setRunMode("bulk")} disabled={busy}>
              Bulk
            </button>
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn" onClick={copyAll} disabled={busy}>
              Copy
            </button>
            <button className="btn" onClick={clearResults} disabled={busy}>
              Clear Results
            </button>
            <button className="btn danger" onClick={resetAll} disabled={busy}>
              Reset
            </button>
          </div>
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

        <div style={{ height: 12 }} />

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

        {runMode === "bulk" && (bulkTotal > 0 || busy) ? (
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

          <div className="playlistGrid">
            <div className="playlistPane">
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

            <div className="playlistPane">
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
                <input
                  value={xtreamSearch}
                  onChange={(e) => setXtreamSearch(e.target.value)}
                  placeholder={xtreamCatId ? "Search channels..." : "Select a category first"}
                  disabled={!xtreamCatId}
                />
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
                  items={filteredXtreamChannels}
                  itemHeight={64}
                  height={xtreamListHeight}
                  render={(ch) => (
                    <div key={(ch as any).id} className="channelRow">
                      <div className="channelLogo">
                        {(ch as any).logo ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={logoSrc((ch as any).logo)}
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
                      <div className="channelName" title={(ch as any).name}>
                        {(ch as any).name}
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

          <div className="playlistGrid">
            <div className="playlistPane">
              <div className="playlistPaneHeader">
                <div className="playlistPaneTitle">Genres</div>
                <div className="small">{stalkerGenres.length}</div>
              </div>
              <div className="playlistControls">
                <input
                  value={stalkerGenreSearch}
                  onChange={(e) => setStalkerGenreSearch(e.target.value)}
                  placeholder={stalkerGenres.length ? "Search genres..." : "Genres will appear after check"}
                  disabled={!stalkerGenres.length}
                />
              </div>
              <div className="scrollArea padded">
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
                        setStalkerPage(0);
                        loadStalkerChannels(g.id, 0, false);
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

            <div className="playlistPane">
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
                        setStalkerPage(0);
                        setStalkerHasMore(false);
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
                <input
                  value={stalkerSearch}
                  onChange={(e) => setStalkerSearch(e.target.value)}
                  placeholder={stalkerGenreId ? "Search channels..." : "Select a genre first"}
                  disabled={!stalkerGenreId}
                />
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
                  items={filteredStalkerChannels}
                  itemHeight={64}
                  height={360}
                  render={(ch) => (
                    <div key={(ch as any).id} className="channelRow">
                      <div className="channelLogo">
                        {(ch as any).logo ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={logoSrc((ch as any).logo)}
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
                      <div className="channelName" title={(ch as any).name}>
                        {(ch as any).name}
                      </div>
                    </div>
                  )}
                />
              ) : null}

              {stalkerGenreId ? (
                <div className="playlistFooter">
                  <div className="small">
                    Loaded: {stalkerChannels.length}
                    {stalkerHasMore ? " • More available" : ""}
                  </div>
                  <button
                    className="btn"
                    disabled={!stalkerHasMore || playlistBusy}
                    onClick={() => {
                      const next = stalkerPage + 1;
                      setStalkerPage(next);
                      loadStalkerChannels(stalkerGenreId, next, true);
                    }}
                  >
                    {playlistBusy ? "Loading..." : "Load more"}
                  </button>
                </div>
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

      <div style={{ height: 16 }} />

      <div className="footerHint">
        <span className="footerLink">Privacy</span>
        <span className="footerTooltip">
          Sends URL + credentials only to your IPTV server endpoints for validation.
          Stores last inputs/results in your browser only.
          No playback.
        </span>
      </div>
    </main>
  );
}
