import { parseArgs } from "node:util";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { doctor, score, summarize } from "../doctor.js";
import { RpcClient } from "../rpc.js";
import { DEFAULT_UA } from "../http.js";
import type { Check, Report } from "../types.js";
import { DISCOVERY_SOURCES, fetchCatalog, selectTargets, type ScanCatalog, type Selection } from "./discover.js";
import { aggregate } from "./aggregate.js";
import { catalogDomainAudit } from "./domain-audit.js";
import type { EndpointResult } from "./outcome.js";
import { writeRaw } from "./raw-file.js";
import { rebuildFromRaw, renderMarkdown } from "./render.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface ScanConfig {
  out: string;
  perHost: number;
  limit?: number;
  concurrency: number;
  catalog?: string;
  timeoutMs: number;
  log: (s: string) => void;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

/** Run up to `concurrency` probes at once, never two against the same host at the same time. */
async function pool<T>(targets: Selection[], concurrency: number, fn: (t: Selection, i: number) => Promise<T>): Promise<T[]> {
  const results = new Array<T>(targets.length);
  const busyHosts = new Set<string>();
  const pending = targets.map((t, i) => ({ t, i }));
  let active = 0;
  return new Promise((resolve) => {
    const kick = () => {
      if (pending.length === 0 && active === 0) return resolve(results);
      while (active < concurrency) {
        const idx = pending.findIndex((p) => !busyHosts.has(p.t.host));
        if (idx < 0) break;
        const { t, i } = pending.splice(idx, 1)[0]!;
        busyHosts.add(t.host);
        active++;
        fn(t, i)
          .then((r) => (results[i] = r))
          .catch(() => {})
          .finally(() => {
            busyHosts.delete(t.host);
            active--;
            kick();
          });
      }
    };
    kick();
  });
}

const failKey = (c: Check) => `${c.id}#${c.accept ?? "-"}`;

/** A failure only counts if it reproduces on a second, serial probe. Otherwise it is downgraded to unknown. */
export function confirm(first: Report, second: Report): Report {
  if (second.verdict === "unknown" && second.checks.some((c) => c.id === "handshake.reachable" || (c.id === "handshake.status-402" && c.status === "unknown"))) {
    return { ...second, verdict: "unknown", settlementBroken: false, noWorkingOption: false, score: 0 };
  }
  const firstFails = new Set(first.checks.filter((c) => c.status === "fail").map(failKey));
  const checks = second.checks.map((c) =>
    c.status === "fail" && !firstFails.has(failKey(c)) ? { ...c, status: "unknown" as const, message: `[did not reproduce] ${c.message}` } : c,
  );
  const s = summarize(checks, second.challenge?.accepts.length ?? 0, false);
  return { ...second, checks, ...s, score: score(checks) };
}

export async function runScan(cfg: ScanConfig) {
  const date = today();
  mkdirSync(join(cfg.out, "raw"), { recursive: true });
  mkdirSync(join(cfg.out, "cache"), { recursive: true });

  // 1. discovery
  let catalog: ScanCatalog;
  const catPath = cfg.catalog ?? join(cfg.out, "cache", `catalog-${date}.json`);
  if (existsSync(catPath)) {
    catalog = JSON.parse(readFileSync(catPath, "utf8")) as ScanCatalog;
    cfg.log(`catalog: reusing ${catPath} (${catalog.items.length} items)`);
  } else {
    catalog = { fetchedAt: new Date().toISOString(), sources: {}, items: [] };
    for (const s of DISCOVERY_SOURCES) {
      cfg.log(`discovering from ${s.name} ...`);
      const r = await fetchCatalog(s, { log: cfg.log });
      catalog.sources[s.name] = { total: r.total, fetched: r.items.length, complete: r.complete };
      catalog.items.push(...r.items);
    }
    writeFileSync(catPath, JSON.stringify(catalog));
  }
  const { targets, stats } = selectTargets(catalog.items, { perHost: cfg.perHost, limit: cfg.limit });
  cfg.log(`selected ${targets.length} GET endpoints across ${new Set(targets.map((t) => t.host)).size} hosts (of ${stats.uniqueUrls} unique URLs, ${stats.hosts} hosts)`);

  const rpc = new RpcClient({ userAgent: DEFAULT_UA, timeoutMs: 12000 });
  const opts = { rpcClient: rpc, timeoutMs: cfg.timeoutMs, checkPublicFacilitators: true };

  // 2. concurrent first pass
  let done = 0;
  const first = await pool(targets, Math.min(4, cfg.concurrency), async (t) => {
    const r = await doctor(t.url, { ...opts, method: t.method });
    done++;
    if (done % 25 === 0 || done === targets.length) cfg.log(`  probed ${done}/${targets.length}`);
    return r;
  });

  // 3. serial confirmation of every failure
  const toConfirm = first.map((r, i) => ({ r, i })).filter(({ r }) => r && r.verdict === "fail");
  cfg.log(`confirming ${toConfirm.length} failures serially ...`);
  const final: Report[] = [...first];
  let c = 0;
  for (const { r, i } of toConfirm) {
    await sleep(1000);
    const again = await doctor(targets[i]!.url, { ...opts, method: targets[i]!.method });
    final[i] = confirm(r, again);
    c++;
    if (c % 25 === 0) cfg.log(`  confirmed ${c}/${toConfirm.length}`);
  }

  const results: EndpointResult[] = targets.map((t, i) => ({ target: t, report: final[i]! })).filter((x) => x.report);

  // 4. catalog-level EIP-712 domain audit (no endpoint contact, on-chain reads only)
  cfg.log("auditing catalog EIP-712 domains ...");
  const domainAudit = await catalogDomainAudit(catalog.items, rpc);

  // 5. write outputs
  const agg = aggregate(results, { date, catalog, stats, domainAudit, perHost: cfg.perHost });
  const rawFile = writeRaw(cfg.out, { date, perHost: cfg.perHost, catalogMeta: { fetchedAt: catalog.fetchedAt, sources: catalog.sources }, stats, domainAudit, results });
  writeFileSync(join(cfg.out, `${date}.json`), JSON.stringify(agg, null, 2));
  writeFileSync(join(cfg.out, "REPORT.md"), renderMarkdown(agg));
  cfg.log(`wrote ${join(cfg.out, `${date}.json`)}, ${join(cfg.out, "REPORT.md")} and (gitignored) ${rawFile}`);
  return agg;
}

/** Thrown for bad scan flags; the CLI maps it to exit code 64. */
export class UsageError extends Error {}

function positiveInt(flag: string, v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new UsageError(`${flag} must be a positive integer, got "${v}"`);
  return n;
}

/** `x402-doctor scan ...` entry point. Returns the process exit code. */
export async function runScanCli(argv: string[]): Promise<number> {
  const { values: o } = parseArgs({
    args: argv,
    options: {
      out: { type: "string" },
      limit: { type: "string" },
      "per-host": { type: "string" },
      concurrency: { type: "string" },
      catalog: { type: "string" },
      timeout: { type: "string" },
      "rebuild-report": { type: "boolean" },
      date: { type: "string" },
    },
  });
  const out = o.out ?? "scan";
  if (o["rebuild-report"]) {
    const date = o.date ?? today();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new UsageError(`--date must be YYYY-MM-DD, got "${date}"`);
    rebuildFromRaw(out, date);
    process.stderr.write(`rebuilt ${join(out, `${date}.json`)} and ${join(out, "REPORT.md")} from ${join(out, "raw")}\n`);
    return 0;
  }
  await runScan({
    out,
    perHost: positiveInt("--per-host", o["per-host"]) ?? 2,
    limit: positiveInt("--limit", o.limit),
    // Hard cap of 4 concurrent hosts: the scan is a courtesy to endpoint owners, not a load test.
    concurrency: Math.min(4, positiveInt("--concurrency", o.concurrency) ?? 4),
    catalog: o.catalog,
    timeoutMs: positiveInt("--timeout", o.timeout) ?? 15000,
    log: (s) => process.stderr.write(s + "\n"),
  });
  return 0;
}

