"use client";

import Script from "next/script";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

declare global {
  interface Window {
    onTurnstileSuccess?: (token: string) => void;
    onTurnstileError?: () => void;
    onTurnstileExpired?: () => void;
    onTurnstileTimeout?: () => void;
  }
}

export default function VerifyClient() {
  const router = useRouter();
  const sp = useSearchParams();

  const returnTo = useMemo(() => {
    const v = sp.get("returnTo") || "/";
    return v.startsWith("/") ? v : "/";
  }, [sp]);

  const [token, setToken] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>("");

  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "";

  // Auto-redirect if Turnstile is not configured (local development)
  useEffect(() => {
    if (!siteKey) {
      router.replace(returnTo);
    }
  }, [siteKey, router, returnTo]);

  useEffect(() => {
    window.onTurnstileSuccess = (t: string) => {
      setToken(String(t || ""));
    };
    window.onTurnstileError = () => {
      setError("Verification failed to load. Please refresh and try again.");
      setToken("");
    };
    window.onTurnstileExpired = () => {
      setError("Verification expired. Please try again.");
      setToken("");
    };
    window.onTurnstileTimeout = () => {
      setError("Verification timed out. Please try again.");
      setToken("");
    };
    return () => {
      delete window.onTurnstileSuccess;
      delete window.onTurnstileError;
      delete window.onTurnstileExpired;
      delete window.onTurnstileTimeout;
    };
  }, []);

  useEffect(() => {
    if (!token || busy) return;

    (async () => {
      setError("");
      setBusy(true);
      try {
        const res = await fetch("/api/verify-human", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-ZoneNew-Client": "1" },
          body: JSON.stringify({ token }),
        });
        const json: unknown = await res.json().catch(() => ({}));
        const obj = typeof json === "object" && json !== null ? (json as Record<string, unknown>) : {};

        if (!res.ok || obj["ok"] !== true) {
          throw new Error(typeof obj["error"] === "string" ? String(obj["error"]) : "Verification failed.");
        }

        router.replace(returnTo);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Unknown error.");
        setToken("");
      } finally {
        setBusy(false);
      }
    })();
  }, [token, busy, router, returnTo]);

  return (
    <main className="container">
      <div className="verifyShell">
        <div className="verifyBox">
          <div className="panel">
            <div className="header" style={{ marginBottom: 10 }}>
              <div>
                <div className="title">Human verification</div>
                <div className="subtitle">This protects the checker from abuse. You will be asked again after 5 minutes.</div>
              </div>
              <button type="button" className="btn" onClick={() => router.replace(returnTo)} disabled={busy}>
                Back
              </button>
            </div>

            <div className="notice" style={{ marginBottom: 12 }}>
              If you are blocked by your browser extensions, try disabling them for this site or open a fresh tab.
            </div>

            {!siteKey ? (
              <div className="verifyError">Server not configured.</div>
            ) : (
              <>
                <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer />
                <div
                  className="cf-turnstile"
                  data-sitekey={siteKey}
                  data-theme="dark"
                  data-callback="onTurnstileSuccess"
                  data-error-callback="onTurnstileError"
                  data-expired-callback="onTurnstileExpired"
                  data-timeout-callback="onTurnstileTimeout"
                />
              </>
            )}

            {busy ? <div className="subtitle" style={{ marginTop: 10 }}>Verifying…</div> : null}
            {error ? <div className="verifyError">{error}</div> : null}
          </div>
        </div>
      </div>
    </main>
  );
}
