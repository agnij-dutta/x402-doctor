import pc from "picocolors";
import type { Category, Check, Report } from "./types.js";
import { labelFor } from "./networks.js";

const ICON: Record<Check["status"], string> = {
  pass: pc.green("✓"),
  warn: pc.yellow("!"),
  fail: pc.red("✗"),
  skip: pc.dim("·"),
  unknown: pc.magenta("?"),
};

const CATEGORY_TITLE: Record<Category, string> = {
  handshake: "Handshake",
  browser: "Browser (CORS)",
  schema: "Schema",
  asset: "Asset (on-chain)",
  payTo: "payTo",
  facilitator: "Facilitator",
};

function scoreColor(s: number) {
  return s >= 90 ? pc.green : s >= 50 ? pc.yellow : pc.red;
}

/** Human-readable terminal report. Colors follow picocolors (NO_COLOR / FORCE_COLOR are honored). */
export function renderPretty(r: Report, opts: { verbose?: boolean } = {}): string {
  const lines: string[] = [];
  const sc = scoreColor(r.score);
  lines.push("");
  lines.push(`${pc.bold("x402-doctor")} ${pc.dim(r.toolVersion)}  ${pc.dim(r.method)} ${pc.underline(r.url)}`);
  lines.push("");
  const verdictText =
    r.verdict === "unknown"
      ? pc.magenta("INCONCLUSIVE")
      : r.settlementBroken
        ? pc.red(pc.bold(r.noWorkingOption ? "PAYMENTS WILL FAIL" : "SOME PAYMENT OPTIONS WILL FAIL"))
        : r.verdict === "fail"
          ? pc.yellow("SETTLES, WITH PROBLEMS")
          : r.verdict === "warn"
            ? pc.green("SETTLEMENT-READY") + pc.dim(" (with warnings)")
            : pc.green(pc.bold("SETTLEMENT-READY"));
  lines.push(`  ${sc(pc.bold(String(r.score).padStart(3)))}${pc.dim("/100")}   ${verdictText}`);
  const browserLine = renderBrowserLine(r);
  if (browserLine) lines.push(`  ${pc.dim("browser")}   ${browserLine}`);
  if (r.version !== undefined) {
    const priceStr = r.prices.map((p) => `${p.human ?? `${p.atomic} atomic`} on ${labelFor(p.network)}`).join(pc.dim(" | "));
    lines.push(`  ${pc.dim("x402")} v${r.version}   ${priceStr}`);
  }
  lines.push("");

  const cats: Category[] = ["handshake", "browser", "schema", "asset", "payTo", "facilitator"];
  for (const cat of cats) {
    const cs = r.checks.filter((c) => c.category === cat && (opts.verbose || c.status !== "skip" || cat === "facilitator"));
    if (!cs.length) continue;
    lines.push(pc.bold(`  ${CATEGORY_TITLE[cat]}`));
    for (const c of cs) {
      if (!opts.verbose && c.status === "pass") {
        lines.push(`   ${ICON.pass} ${pc.dim(c.message)}`);
        continue;
      }
      const msg = c.status === "fail" ? c.message : c.status === "skip" ? pc.dim(c.message) : c.message;
      lines.push(`   ${ICON[c.status]} ${msg}${c.critical && c.status === "fail" ? pc.red(" [blocks settlement]") : ""}`);
      if (c.fix && (c.status === "fail" || c.status === "warn" || c.status === "unknown")) {
        lines.push(`     ${pc.cyan("fix:")} ${c.fix}`);
      }
    }
    lines.push("");
  }
  const n = (s: Check["status"]) => r.checks.filter((c) => c.status === s).length;
  lines.push(
    pc.dim(
      `  ${n("pass")} passed, ${n("warn")} warnings, ${n("fail")} failed, ${n("unknown")} inconclusive · ${r.timingMs} ms · never signed or sent a payment`,
    ),
  );
  lines.push("");
  return lines.join("\n");
}

/** Short labels for the browser verdict line. */
const BROWSER_REASON: Record<string, string> = {
  "cors.allow-origin": "Allow-Origin not usable",
  "cors.allow-origin-single": "Allow-Origin duplicated",
  "handshake.cors-expose": "PAYMENT-REQUIRED not exposed",
  "handshake.cors-preflight": "preflight blocks the payment header",
  "cors.preflight-not-charged": "preflight charged (402)",
};

/** One line under the verdict: is the endpoint usable from a browser? */
export function renderBrowserLine(r: Report): string | undefined {
  const b = r.browser;
  if (!b || r.verdict === "unknown") return undefined;
  const c1 = r.checks.find((c) => c.id === "cors.allow-origin");
  switch (b.status) {
    case "ready":
      return pc.green("READY");
    case "blocked":
      return pc.yellow(`BLOCKED: ${b.failing.map((id) => BROWSER_REASON[id] ?? id).join(", ")}`);
    case "not-browser-facing":
      return pc.dim(c1?.data?.browser === "server-only" ? "not checked (--server-only)" : "not browser-facing (no Allow-Origin)");
    case "refused":
      return pc.dim("refuses browser origins (allowed by the spec)");
    case "restricted":
      return pc.dim(`restricted to another origin; re-run with --origin <your frontend>`);
    default:
      return c1 ? pc.magenta("inconclusive") : undefined;
  }
}

/** Stable JSON report: the full Report object, pretty-printed. */
export function renderJson(r: Report): string {
  return JSON.stringify(r, null, 2);
}
