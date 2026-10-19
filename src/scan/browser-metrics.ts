// FROZEN browser-readiness metrics for public scans.
//
// These definitions are what makes scans comparable over time: the 2026-10-04 numbers in
// x402-foundation/x402#3722 (192 no-expose, 132 preflight-bad, 357 readable, 323 payable) are
// reproduced by the "legacy" functions below, and test/unit.test.ts pins them. Do not edit a
// definition here when a check gets stricter; add a new metric next to the old one instead.
//
// Each endpoint is evaluated from the probe evidence (`data.observed` on `cors.allow-origin`) when the
// report has it (x402-doctor after 0.1.x), and from the 0.1.x check statuses and `data.cors` bucket when it
// doesn't (the 2026-10-04 raw file). The "strict" metrics need the evidence, so they exist for new
// scans only.
import type { Report } from "../types.js";
import type { CorsObserved, ObservedResponse } from "../checks/cors.js";
import { outcomeOf } from "./outcome.js";
import { pct } from "./stats.js";

export interface EndpointBrowserEval {
  /** Answered with a readable x402 challenge (outcome x402-*). */
  live: boolean;
  /** Live, with Allow-Origin on the Origin probe. */
  corsOn: boolean;
  /** #3722 rule: CORS on, PAYMENT-REQUIRED not exposed (v2 only). */
  noExpose: boolean;
  /** #3722 rule: CORS on, preflight non-2xx or payment header not allowed. */
  preflightBad: boolean;
  /** CORS on and the challenge is readable: PAYMENT-REQUIRED exposed (v2) or body challenge (v1). */
  readable: boolean;
  /** Readable, and the preflight passes under the #3722 rule. */
  payable: boolean;
  /** New rules (single Allow-Origin, valid origin, header present with Origin, uncharged preflight, credentialed `*`, Content-Type, method). Absent without evidence. */
  strict?: { readable: boolean; payable: boolean; duplicatedAllowOrigin: boolean; chargedPreflight: boolean };
}

// ---- frozen helpers (copies, on purpose: the checks may change, these must not) ----
const toks = (list: string | null) =>
  (list ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
const okProbe = (o: ObservedResponse | undefined): o is ObservedResponse => !!o && o.status > 0 && o.status !== 429 && o.status < 500;

/** 0.1.x expose bucket. */
function legacyBucket(p2: ObservedResponse, version: number): "none" | "no-expose" | "partial" | "ok" {
  if (!p2.allowOrigin) return "none";
  const acac = (p2.allowCredentials ?? "").toLowerCase() === "true";
  const expose = p2.exposeHeaders;
  const has = (n: string) => toks(expose).some((s) => s === "*" || s === n.toLowerCase()) && !(acac && (expose ?? "").trim() === "*");
  if (version === 2) {
    if (!has("PAYMENT-REQUIRED")) return "no-expose";
    return has("PAYMENT-RESPONSE") ? "ok" : "partial";
  }
  return has("X-PAYMENT-RESPONSE") ? "ok" : "partial";
}

/** 0.1.x preflight rule: undefined when the preflight was inconclusive. */
function legacyPreflightPass(p3: ObservedResponse | undefined, version: number): boolean | undefined {
  if (!okProbe(p3)) return undefined;
  if (p3.status < 200 || p3.status > 299) return false;
  const pay = version === 2 ? "payment-signature" : "x-payment";
  return !!p3.allowOrigin && toks(p3.allowHeaders).some((s) => s === "*" || s === pay);
}

function strictEval(o: CorsObserved, legacy: { readable: boolean; payable: boolean }) {
  const { p2, p3 } = o;
  const cred = (v: string | null) => toks(v).includes("true");
  const allowed = (list: string | null, n: string, c: boolean) => toks(list).includes(n.toLowerCase()) || (toks(list).includes("*") && !c);
  const multi = (r: ObservedResponse | undefined) => okProbe(r) && ((r.allowOrigin ?? "").includes(",") || (r.allowCredentials ?? "").includes(","));
  const duplicatedAllowOrigin = multi(p2) || multi(p3);
  const chargedPreflight = okProbe(p3) && p3.status === 402;
  let readable = false;
  if (legacy.readable && okProbe(p2) && p2.status !== 401 && p2.status !== 403 && !multi(p2)) {
    const acao = (p2.allowOrigin ?? "").trim();
    const validOrigin = acao === "*" || acao === o.origin;
    const v2ok = o.version !== 2 || (allowed(p2.exposeHeaders, "PAYMENT-REQUIRED", cred(p2.allowCredentials)) && (!o.p1.paymentRequired || p2.paymentRequired));
    readable = validOrigin && v2ok;
  }
  let payable = false;
  if (readable && legacy.payable && okProbe(p3) && !multi(p3)) {
    const c = cred(p3.allowCredentials);
    const pay = o.version === 2 ? (o.dual ? ["PAYMENT-SIGNATURE", "X-PAYMENT"] : ["PAYMENT-SIGNATURE"]) : ["X-PAYMENT"];
    const headersOk = pay.every((n) => allowed(p3.allowHeaders, n, c));
    const ctOk = !["POST", "PUT", "PATCH"].includes(o.method) || allowed(p3.allowHeaders, "Content-Type", c);
    const methodOk = ["GET", "HEAD", "POST"].includes(o.method) || allowed(p3.allowMethods, o.method, c);
    payable = headersOk && ctOk && methodOk;
  }
  return { readable, payable, duplicatedAllowOrigin, chargedPreflight };
}

/** Evaluate one report under the frozen definitions. */
export function evalEndpoint(r: Report): EndpointBrowserEval {
  const live = outcomeOf(r).startsWith("x402");
  const none: EndpointBrowserEval = { live, corsOn: false, noExpose: false, preflightBad: false, readable: false, payable: false };
  if (!live) return none;
  const obs = r.checks.find((c) => c.id === "cors.allow-origin")?.data?.observed as CorsObserved | undefined;
  if (obs) {
    if (!okProbe(obs.p2)) return { ...none, strict: { readable: false, payable: false, duplicatedAllowOrigin: false, chargedPreflight: false } };
    const bucket = legacyBucket(obs.p2, obs.version);
    const corsOn = bucket !== "none";
    const pf = corsOn ? legacyPreflightPass(obs.p3, obs.version) : undefined;
    const readable = bucket === "ok" || bucket === "partial";
    const payable = readable && pf === true;
    return { live, corsOn, noExpose: bucket === "no-expose", preflightBad: pf === false, readable, payable, strict: strictEval(obs, { readable, payable }) };
  }
  // 0.1.x report: check statuses and the recorded bucket.
  const cc = r.checks.find((c) => c.id === "handshake.cors-expose");
  const pf = r.checks.find((c) => c.id === "handshake.cors-preflight");
  const bucket = cc?.data?.cors as string | undefined;
  const corsOn = bucket === "no-expose" || bucket === "partial" || bucket === "ok";
  const readable = bucket === "ok" || bucket === "partial";
  return {
    live,
    corsOn,
    noExpose: cc?.status === "fail",
    preflightBad: pf?.status === "fail",
    readable,
    payable: readable && pf?.status === "pass",
  };
}

export interface BrowserMetrics {
  live: number;
  corsOn: number;
  corsOnPct: number;
  /** #3722 "no-expose", % of live. */
  noExpose: number;
  noExposePct: number;
  /** #3722 "preflight-bad", % of live. */
  preflightBad: number;
  preflightBadPct: number;
  readable: number;
  readablePct: number;
  readablePctOfCorsOn: number;
  payable: number;
  payablePct: number;
  payablePctOfCorsOn: number;
  /** Null when no report in the set carries probe evidence (0.1.x scans). */
  strict: null | {
    /** Live endpoints with evidence (the denominator of the strict percentages). */
    endpoints: number;
    readable: number;
    readablePct: number;
    payable: number;
    payablePct: number;
    duplicatedAllowOrigin: number;
    chargedPreflight: number;
  };
}

export function metricsFromEvals(evals: EndpointBrowserEval[]): BrowserMetrics {
  const live = evals.filter((e) => e.live);
  const n = (f: (e: EndpointBrowserEval) => boolean) => live.filter(f).length;
  const corsOn = n((e) => e.corsOn);
  const readable = n((e) => e.readable);
  const payable = n((e) => e.payable);
  const withStrict = live.filter((e) => e.strict);
  const s = (f: (x: NonNullable<EndpointBrowserEval["strict"]>) => boolean) => withStrict.filter((e) => f(e.strict!)).length;
  return {
    live: live.length,
    corsOn,
    corsOnPct: pct(corsOn, live.length),
    noExpose: n((e) => e.noExpose),
    noExposePct: pct(n((e) => e.noExpose), live.length),
    preflightBad: n((e) => e.preflightBad),
    preflightBadPct: pct(n((e) => e.preflightBad), live.length),
    readable,
    readablePct: pct(readable, live.length),
    readablePctOfCorsOn: pct(readable, corsOn),
    payable,
    payablePct: pct(payable, live.length),
    payablePctOfCorsOn: pct(payable, corsOn),
    strict: withStrict.length
      ? {
          endpoints: withStrict.length,
          readable: s((x) => x.readable),
          readablePct: pct(s((x) => x.readable), withStrict.length),
          payable: s((x) => x.payable),
          payablePct: pct(s((x) => x.payable), withStrict.length),
          duplicatedAllowOrigin: s((x) => x.duplicatedAllowOrigin),
          chargedPreflight: s((x) => x.chargedPreflight),
        }
      : null,
  };
}

export const browserMetrics = (reports: Report[]) => metricsFromEvals(reports.map(evalEndpoint));

/**
 * The subset that can be recomputed from a published (anonymized) scan JSON: the two #3722 counts
 * from the per-row failure ids, and CORS-on / readable from the `cors` bucket histogram. Payable
 * needs per-endpoint preflight passes, which the public rows don't carry.
 */
export function metricsFromPublic(agg: {
  endpoints: { outcome: string; fails: string[] }[];
  cors: Record<string, number>;
}): Pick<BrowserMetrics, "live" | "corsOn" | "noExpose" | "noExposePct" | "preflightBad" | "preflightBadPct" | "readable" | "readablePct"> {
  const live = agg.endpoints.filter((r) => r.outcome.startsWith("x402"));
  const noExpose = live.filter((r) => r.fails.includes("handshake.cors-expose")).length;
  const preflightBad = live.filter((r) => r.fails.includes("handshake.cors-preflight")).length;
  const readable = (agg.cors.ok ?? 0) + (agg.cors.partial ?? 0);
  return {
    live: live.length,
    corsOn: readable + (agg.cors["no-expose"] ?? 0),
    noExpose,
    noExposePct: pct(noExpose, live.length),
    preflightBad,
    preflightBadPct: pct(preflightBad, live.length),
    readable,
    readablePct: pct(readable, live.length),
  };
}
