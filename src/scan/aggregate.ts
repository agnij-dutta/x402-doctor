import { createHash, randomBytes } from "node:crypto";
import { isTestnet, labelFor } from "../networks.js";
import type { DomainAuditResult } from "./domain-audit.js";
import { outcomeOf, type EndpointResult, type Outcome } from "./outcome.js";
import { bump, median, pct, quantile, rank } from "./stats.js";
import { FAIL_TITLES, WARN_TITLES } from "./titles.js";

/**
 * One anonymized row per probed endpoint in the public JSON. Deliberately carries only what the probe
 * found, nothing copied from the challenge: per-row networks and prices fingerprint an endpoint
 * against the public Bazaar catalog (about 5% of rows matched exactly one host that way), which would
 * undo the salted id. Network and price distributions are published in aggregate only.
 */
export interface EndpointRow {
  host: string;
  outcome: Outcome;
  version?: number;
  score: number;
  settlementBroken: boolean;
  fails: string[];
  warns: string[];
}

interface DomainFailData {
  network?: string;
  got?: { name?: string; version?: string };
  expected?: { name?: string; version?: string };
}

/** Scan-level inputs to the aggregate, besides the per-endpoint results. */
export interface AggregateContext {
  date: string;
  catalog: { fetchedAt: string; sources: Record<string, { total: number; fetched: number; complete?: boolean }> };
  stats: { uniqueUrls: number; hosts: number; methods: Record<string, number>; nonGet: number; getHosts: number };
  domainAudit: DomainAuditResult;
  perHost: number;
}

/** Salted, non-reversible host id. */
export function anonHost(host: string, salt: Uint8Array): string {
  return "h_" + createHash("sha256").update(salt).update(host).digest("hex").slice(0, 12);
}

/** Turn confirmed per-endpoint reports into the anonymized public scan summary. */
export function aggregate(results: EndpointResult[], ctx: AggregateContext) {
  const outcomes: Record<string, number> = {};
  const failModes: Record<string, number> = {};
  const failModeHosts: Record<string, Set<string>> = {};
  const criticalModes: Record<string, number> = {};
  const warnModes: Record<string, number> = {};
  const networks: Record<string, number> = {};
  const assets: Record<string, number> = {};
  const schemes: Record<string, number> = {};
  const versions: Record<string, number> = {};
  const cors: Record<string, number> = {};
  const domainPairs: Record<string, number> = {};
  const usd: number[] = [];
  const latency: number[] = [];
  const hostsAll = new Set<string>();
  const hostsLive = new Set<string>();
  const hostsBroken = new Set<string>();
  const rows: EndpointRow[] = [];
  // Fresh random salt per report: ids are stable inside one report but can't be linked back to
  // hosts by hashing the (public) discovery catalog.
  const salt = randomBytes(16);
  let live = 0, broken = 0, noWorking = 0, clean = 0, withWarn = 0, testnetOnly = 0, noX402 = 0;

  for (const { target, report: r } of results) {
    const o = outcomeOf(r);
    bump(outcomes, o);
    hostsAll.add(target.host);
    // "live" = answered with a readable x402 challenge. A 402 with no x402 challenge is counted separately.
    if (o === "402-no-x402") noX402++;
    const isLive = o.startsWith("x402");
    const fails = r.checks.filter((c) => c.status === "fail");
    const warns = r.checks.filter((c) => c.status === "warn");
    if (isLive) {
      live++;
      hostsLive.add(target.host);
      if (r.settlementBroken) {
        broken++;
        hostsBroken.add(target.host);
      }
      if (r.noWorkingOption) noWorking++;
      if (fails.length === 0) clean++;
      if (warns.length) withWarn++;
      for (const id of new Set(fails.map((c) => c.id))) {
        bump(failModes, id);
        (failModeHosts[id] ??= new Set()).add(target.host);
        if (fails.some((c) => c.id === id && c.critical)) bump(criticalModes, id);
      }
      for (const id of new Set(warns.map((c) => c.id))) bump(warnModes, id);
      for (const c of fails.filter((c) => c.id === "asset.eip712-domain")) {
        const d = c.data as DomainFailData | undefined;
        const v = (x: string | undefined) => (x === undefined ? "?" : `v${x}`);
        // Older reports (offline-table path) didn't record the network in data; the option itself has it.
        const opt = c.accept === undefined ? undefined : r.challenge?.accepts[c.accept];
        const net = d?.network ?? opt?.caip2 ?? opt?.network;
        bump(domainPairs, `${labelFor(net, net ?? "unknown")}: declared "${d?.got?.name}"/${v(d?.got?.version)}, token is "${d?.expected?.name ?? "?"}"/${v(d?.expected?.version)}`);
      }
      const cc = r.checks.find((c) => c.id === "handshake.cors-expose");
      bump(cors, (cc?.data?.cors as string) ?? cc?.status ?? "n/a");
      if (r.version !== undefined) bump(versions, `v${r.version}`);
      const nets = new Set<string>();
      for (const a of r.challenge?.accepts ?? []) {
        bump(networks, labelFor(a.caip2, a.network ?? "unknown"));
        if (a.caip2) nets.add(a.caip2);
        bump(schemes, a.scheme ?? "unknown");
      }
      if (nets.size && [...nets].every((n) => isTestnet(n))) testnetOnly++;
      for (const p of r.prices) bump(assets, p.symbol ?? (p.asset ? "other" : "unknown"));
      const u = r.prices.map((p) => p.usd).filter((x): x is number => x !== undefined);
      if (u.length) usd.push(Math.min(...u));
      const lat = r.checks.find((c) => c.id === "handshake.latency")?.data?.ms as number | undefined;
      if (lat !== undefined) latency.push(lat);
    }
    rows.push({
      host: anonHost(target.host, salt),
      outcome: o,
      version: r.version,
      score: r.score,
      settlementBroken: r.settlementBroken,
      fails: [...new Set(fails.map((c) => c.id))],
      warns: [...new Set(warns.map((c) => c.id))],
    });
  }

  const failRanked = rank(failModes).map(([id, n]) => ({
    id,
    title: FAIL_TITLES[id] ?? id,
    endpoints: n,
    pctOfLive: pct(n, live),
    hosts: failModeHosts[id]?.size ?? 0,
    blocksSettlement: (criticalModes[id] ?? 0) > 0,
  }));
  return {
    tool: "x402-doctor",
    date: ctx.date,
    method: {
      discovery: Object.entries(ctx.catalog.sources).map(([k, v]) => ({ source: k, listed: v.total, fetched: v.fetched })),
      catalogFetchedAt: ctx.catalog.fetchedAt,
      uniqueUrls: ctx.stats.uniqueUrls,
      uniqueHosts: ctx.stats.hosts,
      catalogMethods: ctx.stats.methods,
      skippedNonGet: ctx.stats.nonGet,
      sampling: `GET-able catalog entries, up to ${ctx.perHost} per host, stable hash order`,
      probe: "unpaid GET + HEAD + CORS GET + OPTIONS preflight, concurrency <= 4, one request at a time per host, never sends payment headers",
      confirmation: "every failing endpoint re-probed serially; only failures that reproduce are counted; rate limits, timeouts, WAF blocks are 'inconclusive', not failures",
    },
    probed: results.length,
    hostsProbed: hostsAll.size,
    outcomes,
    live: {
      endpoints: live,
      hosts: hostsLive.size,
      settlementBroken: broken,
      settlementBrokenPct: pct(broken, live),
      noWorkingOption: noWorking,
      noWorkingOptionPct: pct(noWorking, live),
      hostsWithBrokenEndpoint: hostsBroken.size,
      hostsWithBrokenEndpointPct: pct(hostsBroken.size, hostsLive.size),
      noFailures: clean,
      noFailuresPct: pct(clean, live),
      withWarnings: withWarn,
      testnetOnly,
      no402Challenge: noX402,
    },
    failureModes: failRanked,
    warningModes: rank(warnModes).map(([id, n]) => ({ id, title: WARN_TITLES[id] ?? FAIL_TITLES[id] ?? id, endpoints: n, pctOfLive: pct(n, live) })),
    domainMismatchPairs: rank(domainPairs).map(([k, n]) => ({ pair: k, endpoints: n })),
    cors,
    versions,
    networks: rank(networks),
    assets: rank(assets),
    schemes: rank(schemes),
    priceUsd: { endpointsPriced: usd.length, median: median(usd), p25: quantile(usd, 0.25), p75: quantile(usd, 0.75), min: usd.length ? Math.min(...usd) : undefined, max: usd.length ? Math.max(...usd) : undefined },
    latencyMs: { median: median(latency), p90: quantile(latency, 0.9) },
    catalogDomainAudit: {
      note: "Static check of every EVM exact/eip3009 payment option listed in the discovery catalogs (no endpoint contacted).",
      resourcesChecked: ctx.domainAudit.resourcesChecked,
      resourcesVerified: ctx.domainAudit.resourcesVerified ?? ctx.domainAudit.resourcesChecked,
      resourcesWithMismatch: ctx.domainAudit.resourcesWithMismatch,
      pct: pct(ctx.domainAudit.resourcesWithMismatch, ctx.domainAudit.resourcesVerified ?? ctx.domainAudit.resourcesChecked),
      tuples: ctx.domainAudit.rows,
    },
    endpoints: rows,
  };
}

export type Aggregate = ReturnType<typeof aggregate>;
