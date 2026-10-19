import type { RpcClient } from "./rpc.js";

export type Status = "pass" | "warn" | "fail" | "skip" | "unknown";

export type Category = "handshake" | "browser" | "schema" | "asset" | "payTo" | "facilitator";

export interface Check {
  /** Stable machine id, e.g. "asset.eip712-domain". Used for aggregation in scans. */
  id: string;
  category: Category;
  status: Status;
  title: string;
  /** What we observed. */
  message: string;
  /** How to fix it (present on warn/fail). */
  fix?: string;
  /**
   * True when a failure of this check means a real client's payment cannot settle
   * (signature will not verify, challenge cannot be parsed, funds cannot move).
   */
  critical?: boolean;
  /** Index into accepts[] this check refers to, if any. */
  accept?: number;
  /**
   * Score penalty for this check's status, overriding the default weight (fail 10, warn 3).
   * Advisories set 0: they show in the report but never move the score.
   */
  penalty?: number;
  data?: Record<string, unknown>;
}

export interface NormalizedRequirement {
  index: number;
  scheme?: string;
  network?: string;
  /** CAIP-2 form of the network, when resolvable. */
  caip2?: string;
  /** Atomic amount as string, from `amount` (v2) or `maxAmountRequired` (v1). */
  amount?: unknown;
  asset?: unknown;
  payTo?: unknown;
  maxTimeoutSeconds?: unknown;
  extra?: Record<string, unknown>;
  raw: Record<string, unknown>;
}

export interface Challenge {
  /** 1 or 2 for spec challenges; other numbers are kept so the version check can report them. */
  version: number;
  source: "header" | "body";
  raw: Record<string, unknown>;
  accepts: NormalizedRequirement[];
  resourceUrl?: string;
  extensions?: Record<string, unknown>;
}

export interface PriceInfo {
  accept: number;
  atomic: string;
  decimals?: number;
  symbol?: string;
  human?: string;
  usd?: number;
  network?: string;
  asset?: string;
}

/**
 * Browser (CORS) readiness, derived from the `browser` category checks by summarizeBrowser().
 * - ready: Allow-Origin usable and single-valued, PAYMENT-REQUIRED exposed, preflight passes and isn't charged.
 * - blocked: at least one of those checks failed (ids in `failing`).
 * - not-browser-facing: no Allow-Origin on the 402 (or --server-only).
 * - refused: the 402 is refused (401/403) when an Origin header is sent. Allowed by the spec.
 * - restricted: Allow-Origin is a fixed origin other than the probe origin; re-run with --origin.
 * - unknown: no CORS probe result (no 402, network error, or a failure that didn't reproduce).
 */
export interface BrowserSummary {
  status: "ready" | "blocked" | "not-browser-facing" | "refused" | "restricted" | "unknown";
  failing: string[];
}

export interface Report {
  tool: "x402-doctor";
  toolVersion: string;
  url: string;
  method: string;
  probedAt: string;
  /** 0..100 */
  score: number;
  /** pass = no fails; fail = at least one fail; unknown = could not determine (network error, rate limit). */
  verdict: "pass" | "warn" | "fail" | "unknown";
  /** At least one advertised payment option is broken in a way that stops settlement. */
  settlementBroken: boolean;
  /** No advertised payment option can settle. */
  noWorkingOption: boolean;
  /** Browser (CORS) readiness. Absent in reports from x402-doctor 0.1.x. */
  browser?: BrowserSummary;
  version?: number;
  challenge?: Challenge;
  prices: PriceInfo[];
  checks: Check[];
  timingMs: number;
}

export interface DoctorOptions {
  method?: string;
  timeoutMs?: number;
  userAgent?: string;
  /** Override RPC URLs: key = CAIP-2 network, value = URL (or list). */
  rpc?: Record<string, string | string[]>;
  /** Explicit facilitator base URL to check /supported against. */
  facilitator?: string;
  /** Skip on-chain reads. */
  offline?: boolean;
  /** Check public known facilitators' /supported when no facilitator is given. */
  checkPublicFacilitators?: boolean;
  /** Known public facilitator URLs (overridable for tests). */
  publicFacilitators?: string[];
  /** Origin used for CORS probing (default https://x402-doctor.example). */
  corsOrigin?: string;
  /** Skip the CORS probes and browser checks, for endpoints that are deliberately not browser-facing. */
  serverOnly?: boolean;
  /** Inject fetch (tests). */
  fetch?: typeof fetch;
  /** Share an RPC client (and its cache) across many probes. */
  rpcClient?: RpcClient;
}
