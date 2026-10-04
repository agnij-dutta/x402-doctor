import type { Check, DoctorOptions, PriceInfo, Report } from "./types.js";
import { DEFAULT_UA, VERSION, request } from "./http.js";
import { checkHandshake } from "./checks/handshake.js";
import { checkSchema } from "./checks/schema.js";
import { checkAsset, makePrice } from "./checks/asset.js";
import { checkPayTo } from "./checks/payto.js";
import { checkFacilitator } from "./checks/facilitator.js";
import { RpcClient } from "./rpc.js";
import { PUBLIC_FACILITATORS } from "./networks.js";

/** Score penalties per check status. */
export const WEIGHTS = { criticalFail: 25, fail: 10, warn: 3 };

/**
 * 100 minus weighted penalties. A missing 402 scores 0, and any settlement-blocking failure caps the
 * score at 49 so a "mostly fine" endpoint that can't actually be paid never looks healthy.
 */
export function score(checks: Check[]): number {
  let s = 100;
  for (const c of checks) {
    if (c.status === "fail") s -= c.critical ? WEIGHTS.criticalFail : WEIGHTS.fail;
    else if (c.status === "warn") s -= WEIGHTS.warn;
  }
  const critical = checks.some((c) => c.status === "fail" && c.critical);
  if (checks.some((c) => c.id === "handshake.status-402" && c.status === "fail")) return 0;
  if (critical) s = Math.min(s, 49);
  return Math.max(0, Math.min(100, s));
}

/** Verdict plus the two settlement flags, derived from the checks. Inconclusive never beats a confirmed fail. */
export function summarize(checks: Check[], acceptCount: number, inconclusive: boolean) {
  const anyFail = checks.some((c) => c.status === "fail");
  const anyWarn = checks.some((c) => c.status === "warn");
  const criticalFails = checks.filter((c) => c.status === "fail" && c.critical);
  const settlementBroken = criticalFails.length > 0;
  const globalBroken = criticalFails.some((c) => c.accept === undefined);
  const brokenAccepts = new Set(criticalFails.filter((c) => c.accept !== undefined).map((c) => c.accept));
  const noWorkingOption = globalBroken || (acceptCount > 0 && brokenAccepts.size >= acceptCount);
  const verdict: Report["verdict"] = anyFail ? "fail" : inconclusive ? "unknown" : anyWarn ? "warn" : "pass";
  return { verdict, settlementBroken, noWorkingOption };
}

/** Probe an x402 endpoint without paying. Never sends a payment header. */
export async function doctor(url: string, opts: DoctorOptions = {}): Promise<Report> {
  const t0 = performance.now();
  const method = (opts.method ?? "GET").toUpperCase();
  const fetchImpl = opts.fetch ?? fetch;
  const ua = opts.userAgent ?? DEFAULT_UA;
  const timeoutMs = opts.timeoutMs ?? 15000;
  const corsOrigin = opts.corsOrigin ?? "https://x402-doctor.example";
  const base = { timeoutMs, userAgent: ua, fetchImpl };

  const primary = await request(url, {
    ...base,
    method,
    headers: method === "POST" || method === "PUT" || method === "PATCH" ? { "content-type": "application/json" } : undefined,
  });
  let head, corsGet, preflight;
  if (primary.ok && primary.status === 402) {
    // sequential: be polite to the server under test
    head = method === "GET" ? await request(url, { ...base, method: "HEAD" }) : undefined;
    corsGet = await request(url, { ...base, method, headers: { origin: corsOrigin } });
    const isV2 = !!primary.headers.get("payment-required");
    preflight = await request(url, {
      ...base,
      method: "OPTIONS",
      headers: {
        origin: corsOrigin,
        "access-control-request-method": method,
        "access-control-request-headers": isV2 ? "payment-signature,content-type" : "x-payment,content-type",
      },
    });
  }

  const hs = checkHandshake({ url, method, primary, head, corsGet, preflight, corsOrigin });
  const checks: Check[] = [...hs.checks];
  const prices: PriceInfo[] = [];
  const ch = hs.challenge;

  if (ch) {
    checks.push(...checkSchema(ch, url));
    const rpc = opts.offline ? undefined : (opts.rpcClient ?? new RpcClient({ overrides: opts.rpc, fetchImpl: opts.fetch, userAgent: ua }));
    for (const a of ch.accepts) {
      const [asset, payTo] = await Promise.all([checkAsset(a, rpc), checkPayTo(a, rpc)]);
      checks.push(...asset.checks, ...payTo);
      const p = asset.price ?? makePrice(a);
      if (p) prices.push(p);
    }
    if (ch.accepts.length) {
      checks.push(
        ...(await checkFacilitator(ch.accepts, ch.version, {
          facilitator: opts.facilitator,
          publicFacilitators: opts.publicFacilitators ?? PUBLIC_FACILITATORS,
          fetchImpl,
          userAgent: ua,
          checkPublic: opts.checkPublicFacilitators ?? !opts.offline,
        })),
      );
    }
  }

  const { verdict, settlementBroken, noWorkingOption } = summarize(checks, ch?.accepts.length ?? 0, hs.inconclusive);
  return {
    tool: "x402-doctor",
    toolVersion: VERSION,
    url,
    method,
    probedAt: new Date().toISOString(),
    score: hs.inconclusive ? 0 : score(checks),
    verdict,
    settlementBroken,
    noWorkingOption,
    version: ch?.version,
    challenge: ch,
    prices,
    checks,
    timingMs: Math.round(performance.now() - t0),
  };
}
