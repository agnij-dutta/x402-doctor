import type { RpcClient } from "./rpc.js";

export type Status = "pass" | "warn" | "fail" | "skip" | "unknown";

export type Category = "handshake" | "schema" | "asset" | "payTo" | "facilitator";

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
  /** Origin used for CORS probing. */
  corsOrigin?: string;
  /** Inject fetch (tests). */
  fetch?: typeof fetch;
  /** Share an RPC client (and its cache) across many probes. */
  rpcClient?: RpcClient;
}
