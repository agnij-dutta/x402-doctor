#!/usr/bin/env node
import { parseArgs } from "node:util";
import { doctor } from "./doctor.js";
import { renderJson, renderPretty } from "./report.js";
import { VERSION } from "./http.js";
import type { Report } from "./types.js";

const HELP = `x402-doctor ${VERSION}: Lighthouse for x402 endpoints. Probes without paying.

Usage
  npx @0xholmes/x402-doctor <url> [url...] [options]
  npx @0xholmes/x402-doctor scan [scan options]
  (installed globally, the command is x402-doctor)

Options
  -X, --method <M>         HTTP method for the unpaid probe (default GET)
      --json               JSON output (one report, or an array for several URLs)
      --facilitator <url>  Check the facilitator's /supported covers each payment option
      --rpc <caip2=url>    Override an RPC, e.g. --rpc eip155:8453=https://... (repeatable)
      --offline            Skip on-chain reads and public facilitator lookups (--facilitator is still checked)
      --timeout <ms>       Per-request timeout (default 15000)
      --min-score <n>      Exit 1 if score is below n (default: exit 1 on any failure)
      --strict             Treat warnings as failures for the exit code (ignored with --min-score)
  -v, --verbose            Show every check, with details and skipped checks
      --version            Print the version
  -h, --help

Exit codes: 0 ok, 1 failed checks / below --min-score, 2 endpoint inconclusive (network error,
            rate limit, 5xx, WAF), 64 usage error, 70 internal error.

Scan options (public scan of discovered endpoints; never pays)
      --out <dir>          Output dir (default ./scan)
      --limit <n>          Max endpoints to probe
      --per-host <n>       Max endpoints per host (default 2)
      --concurrency <n>    Max parallel probes (capped at 4, default 4)
      --catalog <file>     Reuse a cached discovery catalog
      --timeout <ms>       Per-request timeout (default 15000)
      --rebuild-report     Re-aggregate REPORT.md and <date>.json from the local raw file, no probing
      --date <YYYY-MM-DD>  Which raw file --rebuild-report uses (default today)
`;

/** Parse a numeric flag, exiting 64 instead of letting NaN slip through (NaN comparisons are always false). */
function numberFlag(flag: string, v: string | undefined, check: (n: number) => boolean, expect: string): number | undefined {
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || !check(n)) {
    process.stderr.write(`${flag} must be ${expect}, got "${v}"\n`);
    process.exit(64);
  }
  return n;
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === "scan") {
    const { runScanCli, UsageError } = await import("./scan/run.js");
    try {
      process.exit(await runScanCli(argv.slice(1)));
    } catch (e) {
      if (e instanceof UsageError || (e as { code?: string }).code?.startsWith("ERR_PARSE_ARGS")) {
        process.stderr.write(`${(e as Error).message}\n\n${HELP}`);
        process.exit(64);
      }
      throw e;
    }
  }
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        method: { type: "string", short: "X" },
        json: { type: "boolean" },
        facilitator: { type: "string" },
        rpc: { type: "string", multiple: true },
        offline: { type: "boolean" },
        timeout: { type: "string" },
        "min-score": { type: "string" },
        strict: { type: "boolean" },
        verbose: { type: "boolean", short: "v" },
        help: { type: "boolean", short: "h" },
        version: { type: "boolean" },
      },
    });
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n\n${HELP}`);
    process.exit(64);
  }
  const { values: o, positionals } = parsed;
  if (o.version) {
    process.stdout.write(VERSION + "\n");
    return;
  }
  if (o.help || positionals.length === 0) {
    process.stdout.write(HELP);
    process.exit(o.help ? 0 : 64);
  }
  const rpc: Record<string, string[]> = {};
  for (const kv of o.rpc ?? []) {
    const idx = kv.lastIndexOf("=");
    if (idx < 0) {
      process.stderr.write(`--rpc expects caip2=url, got ${kv}\n`);
      process.exit(64);
    }
    const k = kv.slice(0, idx);
    (rpc[k] ??= []).push(kv.slice(idx + 1));
  }
  const timeoutMs = numberFlag("--timeout", o.timeout, (n) => Number.isInteger(n) && n > 0, "a positive integer (ms)");
  const minScore = numberFlag("--min-score", o["min-score"], (n) => n >= 0 && n <= 100, "a number from 0 to 100");
  const reports: Report[] = [];
  for (const url of positionals) {
    try {
      new URL(url);
    } catch {
      process.stderr.write(`Not a URL: ${url}\n`);
      process.exit(64);
    }
    const r = await doctor(url, {
      method: o.method,
      facilitator: o.facilitator,
      rpc,
      offline: o.offline,
      timeoutMs,
    });
    reports.push(r);
    if (!o.json) process.stdout.write(renderPretty(r, { verbose: o.verbose }));
  }
  if (o.json) process.stdout.write((reports.length === 1 ? renderJson(reports[0]!) : JSON.stringify(reports, null, 2)) + "\n");

  const failed = reports.some(
    (r) =>
      r.verdict !== "unknown" &&
      (minScore !== undefined ? r.score < minScore : r.verdict === "fail" || (!!o.strict && r.verdict === "warn")),
  );
  process.exit(failed ? 1 : reports.some((r) => r.verdict === "unknown") ? 2 : 0);
}

main().catch((e: unknown) => {
  process.stderr.write(`x402-doctor crashed: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
  process.exit(70);
});
