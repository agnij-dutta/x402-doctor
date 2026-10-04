import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { aggregate, type Aggregate } from "./aggregate.js";
import { readRaw } from "./raw-file.js";
import { rank } from "./stats.js";

function money(n: number | undefined) {
  if (n === undefined) return "n/a";
  return n < 0.01 ? `$${n.toPrecision(2)}` : `$${n.toFixed(n < 1 ? 3 : 2).replace(/0$/, "")}`;
}

/** Render the human REPORT.md from an aggregate. */
export function renderMarkdown(a: Aggregate): string {
  const L: string[] = [];
  const top = a.failureModes[0];
  L.push(`# x402-doctor public scan, ${a.date}`);
  L.push("");
  L.push(`Probed **${a.probed}** public x402 endpoints across **${a.hostsProbed}** hosts, discovered from the facilitator Bazaar catalogs (${a.method.discovery.map((d) => `${d.source}: ${d.listed.toLocaleString("en-US")} listed`).join(", ")}). No payment was signed or sent.`);
  L.push("");
  L.push("## Headline");
  L.push("");
  L.push(`- **${a.live.endpoints}** endpoints answered an unpaid GET with HTTP 402 and a readable x402 challenge (${a.live.hosts} hosts). Another ${a.live.no402Challenge} answered 402 with no x402 challenge at all.`);
  L.push(`- **${a.live.settlementBrokenPct}%** of them (${a.live.settlementBroken}) advertise at least one payment option that cannot settle as advertised (a confirmed, settlement-blocking failure).`);
  L.push(`- **${a.live.noWorkingOptionPct}%** (${a.live.noWorkingOption}) have **no** working payment option at all.`);
  L.push(`- **${a.live.noFailuresPct}%** (${a.live.noFailures}) have no confirmed failures.`);
  if (top) L.push(`- Most common failure: **${top.title}**, ${top.endpoints} endpoints (${top.pctOfLive}% of live).${top.blocksSettlement ? "" : " It breaks browser clients only; server-side agents can still pay."}`);
  const topBlock = a.failureModes.find((f) => f.blocksSettlement);
  if (topBlock && topBlock !== top) L.push(`- Most common settlement-blocking failure: **${topBlock.title}**, ${topBlock.endpoints} endpoints (${topBlock.pctOfLive}% of live).`);
  L.push(`- Median price: **${money(a.priceUsd.median)}** per request (p25 ${money(a.priceUsd.p25)}, p75 ${money(a.priceUsd.p75)}, n=${a.priceUsd.endpointsPriced}).`);
  L.push("");
  L.push("## Outcomes of the unpaid probe");
  L.push("");
  L.push("| outcome | endpoints | meaning |");
  L.push("|---|---:|---|");
  const meaning: Record<string, string> = {
    "x402-ok": "402 with a valid challenge, no confirmed failures",
    "x402-issues": "402, confirmed failures that don't block settlement (e.g. CORS)",
    "x402-broken": "402, at least one option can't settle",
    "402-no-x402": "402 but no readable x402 challenge",
    "served-free": "2xx without payment (paywall missing on GET)",
    gone: "404/410: listed in the catalog but gone",
    "host-disabled": "402 from the hosting platform (deployment disabled), not x402",
    method: "405: GET not allowed",
    auth: "401/403 instead of 402",
    "other-status": "other status",
    unreachable: "DNS/TLS/timeout/connection error",
    inconclusive: "429/5xx/WAF; not counted as failure",
  };
  for (const [k, n] of rank(a.outcomes)) L.push(`| ${k} | ${n} | ${meaning[k] ?? ""} |`);
  L.push("");
  L.push("## Failure modes (confirmed on a second serial probe), among live 402 endpoints");
  L.push("");
  L.push("| # | failure | endpoints | % of live | hosts | blocks settlement |");
  L.push("|---:|---|---:|---:|---:|:---:|");
  a.failureModes.forEach((f, i) => L.push(`| ${i + 1} | ${f.title} (\`${f.id}\`) | ${f.endpoints} | ${f.pctOfLive}% | ${f.hosts} | ${f.blocksSettlement ? "yes" : "no"} |`));
  L.push("");
  if (a.domainMismatchPairs.length) {
    L.push("### EIP-712 domain mismatches seen live");
    L.push("");
    for (const p of a.domainMismatchPairs) L.push(`- ${p.pair}: ${p.endpoints} endpoints`);
    L.push("");
  }
  if (a.warningModes.length) {
    L.push("## Warnings");
    L.push("");
    L.push("| warning | endpoints | % of live |");
    L.push("|---|---:|---:|");
    for (const w of a.warningModes) L.push(`| ${w.title} (\`${w.id}\`) | ${w.endpoints} | ${w.pctOfLive}% |`);
    L.push("");
  }
  L.push("## Catalog-wide EIP-712 domain audit");
  L.push("");
  const da = a.catalogDomainAudit;
  L.push(`${da.note} ${da.resourcesChecked.toLocaleString("en-US")} cataloged resources declare an EVM eip3009 option; ${da.resourcesVerified.toLocaleString("en-US")} of them have at least one such option x402-doctor could verify on-chain, and **${da.resourcesWithMismatch.toLocaleString("en-US")} (${da.pct}%)** declare a domain that doesn't match the token. The rest are on chains without a keyless RPC in x402-doctor ("skip") or sign for a separate verifying contract such as Circle Gateway, which is checked off-chain ("separate verifier").`);
  L.push("");
  L.push("| network | token | declared name / version | on-chain | resources |");
  L.push("|---|---|---|---|---:|");
  for (const t of a.catalogDomainAudit.tuples.slice(0, 25)) {
    const exp =
      t.status === "fail" && t.expected
        ? `"${t.expected.name}" / ${t.expected.version ?? "?"}`
        : t.status === "pass"
          ? "matches"
          : t.status === "unknown" && t.verifyingContract
            ? "separate verifier"
            : t.status === "skip"
              ? "skip (no RPC)"
              : t.status;
    L.push(`| ${t.networkLabel} | ${t.symbol ?? t.asset.slice(0, 10)} | "${t.declared.name}" / ${t.declared.version} | ${exp} | ${t.resources} |`);
  }
  L.push("");
  L.push("## Distribution (live endpoints)");
  L.push("");
  L.push(`- Versions: ${rank(a.versions).map(([k, n]) => `${k} ${n}`).join(", ")}`);
  L.push(`- Networks (payment options): ${a.networks.slice(0, 10).map(([k, n]) => `${k} ${n}`).join(", ")}`);
  L.push(`- Assets: ${a.assets.slice(0, 8).map(([k, n]) => `${k} ${n}`).join(", ")}`);
  L.push(`- Schemes: ${a.schemes.map(([k, n]) => `${k} ${n}`).join(", ")}`);
  L.push(`- CORS on the 402: ${rank(a.cors).map(([k, n]) => `${k} ${n}`).join(", ")}`);
  L.push(`- Testnet-only endpoints: ${a.live.testnetOnly}`);
  L.push(`- 402 latency: median ${a.latencyMs.median ?? "n/a"} ms, p90 ${a.latencyMs.p90 ?? "n/a"} ms`);
  L.push("");
  L.push("## Method");
  L.push("");
  L.push(`- Discovery: ${a.method.uniqueUrls.toLocaleString("en-US")} unique URLs on ${a.method.uniqueHosts.toLocaleString("en-US")} hosts. ${a.method.skippedNonGet.toLocaleString("en-US")} catalog entries are POST-only and were not probed (x402-doctor only sends GET/HEAD/OPTIONS in scans).`);
  L.push(`- Sampling: ${a.method.sampling}.`);
  L.push(`- Probe: ${a.method.probe}.`);
  L.push(`- Confirmation: ${a.method.confirmation}.`);
  L.push("- On-chain reads: keyless public RPCs; RPC errors are inconclusive, never failures.");
  L.push("- Endpoints are anonymized here: the JSON uses random per-report ids (salted, salt never written), and each row carries only outcome, score and check ids, not the networks or prices that could be matched against the public catalogs. Per-endpoint raw data stays local so owners can fix things before anyone is named.");
  L.push("");
  return L.join("\n");
}

/** Re-aggregate from the local raw file (after a checker fix) without re-probing anything. */
export function rebuildFromRaw(out: string, date: string) {
  const raw = readRaw(out, date);
  const agg = aggregate(raw.results, { date: raw.date, catalog: raw.catalogMeta, stats: raw.stats, domainAudit: raw.domainAudit, perHost: raw.perHost });
  writeFileSync(join(out, `${raw.date}.json`), JSON.stringify(agg, null, 2));
  writeFileSync(join(out, "REPORT.md"), renderMarkdown(agg));
}

