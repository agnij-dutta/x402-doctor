import type { Report } from "../types.js";
import type { Selection } from "./discover.js";

/** One probed endpoint and its (confirmed) report. */
export interface EndpointResult {
  target: Selection;
  report: Report;
}

export type Outcome =
  | "x402-ok" // 402 + parseable challenge, no confirmed failures
  | "x402-broken" // 402 + at least one confirmed settlement-blocking failure
  | "x402-issues" // 402, confirmed non-critical failures only
  | "402-no-x402" // 402 without an x402 challenge (other protocol / custom)
  | "served-free" // 2xx to an unpaid GET
  | "gone" // 404/410
  | "host-disabled" // 402 from the hosting platform (e.g. Vercel DEPLOYMENT_DISABLED)
  | "method" // 405
  | "auth" // 401/403
  | "other-status"
  | "unreachable" // DNS/TLS/timeout/refused
  | "inconclusive"; // 429/5xx/WAF/non-reproducible

/** Classify a report into one scan outcome bucket. Network errors and rate limits never count as failures. */
export function outcomeOf(r: Report): Outcome {
  const st = r.checks.find((c) => c.id === "handshake.status-402");
  const reach = r.checks.find((c) => c.id === "handshake.reachable");
  if (reach) return "unreachable";
  if (!st || st.status === "unknown") return "inconclusive";
  if (st.status === "fail") {
    if (st.data?.platform) return "host-disabled";
    const s = (st.data?.status as number) ?? 0;
    if (s >= 200 && s < 300) return "served-free";
    if (s === 404 || s === 410) return "gone";
    if (s === 405) return "method";
    if (s === 401 || s === 403) return "auth";
    return "other-status";
  }
  const dec = r.checks.find((c) => c.id === "handshake.challenge-decode");
  if (dec?.status === "fail" && !r.challenge) return "402-no-x402";
  if (r.settlementBroken) return "x402-broken";
  if (r.checks.some((c) => c.status === "fail")) return "x402-issues";
  return "x402-ok";
}
