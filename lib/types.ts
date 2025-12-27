export type Mode = "xtream" | "stalker";
export type RunMode = "single" | "bulk";

export type CheckResult = {
  ok: boolean;
  error?: string;

  expiryDate: string; // display-ready
  maxConnections: string; // display-ready
  realUrl: string;
  port: string;
  timezone: string;

  // Stalker-only extras (kept optional so Xtream stays minimal)
  portalIp?: string;
  channels?: string;
};

export type BulkRowResult = {
  lineNumber?: number;
  input: string;
  result: CheckResult;
};
