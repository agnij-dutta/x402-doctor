// `x402-doctor scan compare --from <date> --to <date>`: pair two local raw scans by URL and report
// browser-readiness counts for all live endpoints, for the panel of endpoints live in both scans
// (with transitions), and churn. Raw files are read locally because pairing needs the URLs; the
// output carries counts only, never a URL or host.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { evalEndpoint, metricsFromEvals, type BrowserMetrics, type EndpointBrowserEval } from "./browser-metrics.js";
import { readRaw, type RawScanFile } from "./raw-file.js";
import type { Report } from "../types.js";
import { UsageError } from "./errors.js";

type Flag = "corsOn" | "noExpose" | "preflightBad" | "readable" | "payable";
const FLAGS: Flag[] = ["corsOn", "noExpose", "preflightBad", "readable", "payable"];

export interface Transition {
  /** false then true */
  gained: number;
  /** true then false */
  lost: number;
  /** true in both */
  kept: number;
  /** false in both */
  never: number;
}

export interface Comparison {
  tool: "x402-doctor";
  from: string;
  to: string;
  note: string;
  all: { from: BrowserMetrics; to: BrowserMetrics };
  panel: {
    endpoints: number;
    from: BrowserMetrics;
    to: BrowserMetrics;
    transitions: Record<Flag, Transition>;
    /** Per browser check, when both scans carry probe evidence: fail->pass and pass->fail counts. */
    checks: Record<string, { failToPass: number; passToFail: number }> | null;
  };
  churn: {
    /** Live in `from`, probed in `to` but no longer live. */
    noLongerLive: number;
    /** Not live (or not probed) in `from`, live in `to`. */
    newlyLive: number;
    /** Probed in `from` only. */
    notReprobed: number;
    /** Probed in `to` only. */
    newTargets: number;
  };
}

const key = (r: { target: { url: string; method: string } }) => `${r.target.method} ${r.target.url}`;
const hasEvidence = (r: Report) => r.checks.some((c) => c.id === "cors.allow-origin" && c.data?.observed);

function transition(pairs: [EndpointBrowserEval, EndpointBrowserEval][], f: Flag): Transition {
  const t: Transition = { gained: 0, lost: 0, kept: 0, never: 0 };
  for (const [a, b] of pairs) {
    if (a[f] && b[f]) t.kept++;
    else if (a[f]) t.lost++;
    else if (b[f]) t.gained++;
    else t.never++;
  }
  return t;
}

export function compareRaw(from: RawScanFile, to: RawScanFile): Comparison {
  const toBy = new Map(to.results.map((r) => [key(r), r]));
  const fromBy = new Map(from.results.map((r) => [key(r), r]));
  const fromEvals = new Map(from.results.map((r) => [key(r), evalEndpoint(r.report)]));
  const toEvals = new Map(to.results.map((r) => [key(r), evalEndpoint(r.report)]));

  const pairs: [EndpointBrowserEval, EndpointBrowserEval][] = [];
  const reportPairs: [Report, Report][] = [];
  let noLongerLive = 0;
  let newlyLive = 0;
  for (const [k, a] of fromEvals) {
    const b = toEvals.get(k);
    if (!b) continue;
    if (a.live && b.live) {
      pairs.push([a, b]);
      reportPairs.push([fromBy.get(k)!.report, toBy.get(k)!.report]);
    } else if (a.live) noLongerLive++;
    else if (b.live) newlyLive++;
  }
  for (const [k, b] of toEvals) if (!fromEvals.has(k) && b.live) newlyLive++;

  let checks: Comparison["panel"]["checks"] = null;
  if (reportPairs.length && reportPairs.every(([a, b]) => hasEvidence(a) && hasEvidence(b))) {
    checks = {};
    for (const [a, b] of reportPairs) {
      for (const cb of b.checks.filter((c) => c.category === "browser")) {
        const ca = a.checks.find((c) => c.id === cb.id);
        if (!ca) continue;
        const e = (checks[cb.id] ??= { failToPass: 0, passToFail: 0 });
        if (ca.status === "fail" && cb.status === "pass") e.failToPass++;
        if (ca.status === "pass" && cb.status === "fail") e.passToFail++;
      }
    }
  }

  return {
    tool: "x402-doctor",
    from: from.date,
    to: to.date,
    note: "Counts only. Panel = endpoints live (readable x402 402) in both scans, paired by method and URL. The scan can't see an endpoint's server stack, so a change here is a change on this endpoint set, not evidence that any particular SDK release caused it.",
    all: { from: metricsFromEvals([...fromEvals.values()]), to: metricsFromEvals([...toEvals.values()]) },
    panel: {
      endpoints: pairs.length,
      from: metricsFromEvals(pairs.map((p) => p[0])),
      to: metricsFromEvals(pairs.map((p) => p[1])),
      transitions: Object.fromEntries(FLAGS.map((f) => [f, transition(pairs, f)])) as Record<Flag, Transition>,
      checks,
    },
    churn: {
      noLongerLive,
      newlyLive,
      notReprobed: [...fromBy.keys()].filter((k) => !toBy.has(k)).length,
      newTargets: [...toBy.keys()].filter((k) => !fromBy.has(k)).length,
    },
  };
}

export function renderCompareMarkdown(c: Comparison): string {
  const L: string[] = [];
  const row = (label: string, a: BrowserMetrics, b: BrowserMetrics, n: (m: BrowserMetrics) => number, p: (m: BrowserMetrics) => number) =>
    L.push(`| ${label} | ${n(a)} (${p(a)}%) | ${n(b)} (${p(b)}%) |`);
  const table = (title: string, a: BrowserMetrics, b: BrowserMetrics) => {
    L.push(`### ${title}`);
    L.push("");
    L.push(`| metric (% of live) | ${c.from} | ${c.to} |`);
    L.push("|---|---:|---:|");
    L.push(`| live | ${a.live} | ${b.live} |`);
    row("CORS on", a, b, (m) => m.corsOn, (m) => m.corsOnPct);
    row("PAYMENT-REQUIRED not exposed", a, b, (m) => m.noExpose, (m) => m.noExposePct);
    row("preflight blocks the payment header", a, b, (m) => m.preflightBad, (m) => m.preflightBadPct);
    row("browser-readable", a, b, (m) => m.readable, (m) => m.readablePct);
    row("browser-payable", a, b, (m) => m.payable, (m) => m.payablePct);
    if (a.strict || b.strict) {
      const s = (m: BrowserMetrics) => (m.strict ? `${m.strict.payable} (${m.strict.payablePct}%)` : "n/a");
      L.push(`| strict browser-payable | ${s(a)} | ${s(b)} |`);
    }
    L.push("");
  };
  L.push(`# x402-doctor browser readiness, ${c.from} vs ${c.to}`);
  L.push("");
  L.push(c.note);
  L.push("");
  table("All live endpoints", c.all.from, c.all.to);
  table(`Panel: ${c.panel.endpoints} endpoints live in both scans`, c.panel.from, c.panel.to);
  L.push("### Panel transitions");
  L.push("");
  L.push("| metric | gained | lost | kept | never |");
  L.push("|---|---:|---:|---:|---:|");
  for (const [f, t] of Object.entries(c.panel.transitions)) L.push(`| ${f} | ${t.gained} | ${t.lost} | ${t.kept} | ${t.never} |`);
  L.push("");
  if (c.panel.checks) {
    L.push("| check | fail to pass | pass to fail |");
    L.push("|---|---:|---:|");
    for (const [id, t] of Object.entries(c.panel.checks)) L.push(`| \`${id}\` | ${t.failToPass} | ${t.passToFail} |`);
    L.push("");
  }
  L.push("### Churn");
  L.push("");
  L.push(`- No longer live: ${c.churn.noLongerLive}`);
  L.push(`- Newly live: ${c.churn.newlyLive}`);
  L.push(`- Probed only in ${c.from}: ${c.churn.notReprobed}; only in ${c.to}: ${c.churn.newTargets}`);
  L.push("");
  return L.join("\n");
}

/** `x402-doctor scan compare ...`. Returns the exit code. */
export function runCompareCli(argv: string[]): number {
  const { values: o } = parseArgs({ args: argv, options: { from: { type: "string" }, to: { type: "string" }, out: { type: "string" } } });
  const date = /^\d{4}-\d{2}-\d{2}$/;
  if (!o.from || !o.to || !date.test(o.from) || !date.test(o.to)) {
    throw new UsageError("scan compare needs --from YYYY-MM-DD and --to YYYY-MM-DD");
  }
  const out = o.out ?? "scan";
  const c = compareRaw(readRaw(out, o.from), readRaw(out, o.to));
  const jsonPath = join(out, `compare-${o.from}-${o.to}.json`);
  writeFileSync(jsonPath, JSON.stringify(c, null, 2));
  writeFileSync(join(out, "COMPARE.md"), renderCompareMarkdown(c));
  process.stderr.write(`wrote ${jsonPath} and ${join(out, "COMPARE.md")}\n`);
  return 0;
}
