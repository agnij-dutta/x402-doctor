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
  if (r.version !== undefined) {
    const priceStr = r.prices.map((p) => `${p.human ?? `${p.atomic} atomic`} on ${labelFor(p.network)}`).join(pc.dim(" | "));
    lines.push(`  ${pc.dim("x402")} v${r.version}   ${priceStr}`);
  }
  lines.push("");

  const cats: Category[] = ["handshake", "schema", "asset", "payTo", "facilitator"];
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

/** Stable JSON report: the full Report object, pretty-printed. */
export function renderJson(r: Report): string {
  return JSON.stringify(r, null, 2);
}
