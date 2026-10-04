// The local, gitignored per-endpoint record of a scan (scan/raw/<date>.raw.json). It holds
// everything needed to re-aggregate without probing again, so checker fixes can be applied to a
// finished scan with `x402-doctor scan --rebuild-report`.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AggregateContext } from "./aggregate.js";
import type { EndpointResult } from "./outcome.js";

export interface RawScanFile {
  date: string;
  perHost: number;
  catalogMeta: AggregateContext["catalog"];
  stats: AggregateContext["stats"];
  domainAudit: AggregateContext["domainAudit"];
  results: EndpointResult[];
  /** Set when a subset of endpoints was re-probed after a checker fix. */
  reprobed?: { count: number; reason: string };
}

export const rawPath = (out: string, date: string) => join(out, "raw", `${date}.raw.json`);

export function writeRaw(out: string, raw: RawScanFile): string {
  const p = rawPath(out, raw.date);
  writeFileSync(p, JSON.stringify(raw, null, 1));
  return p;
}

/** Read a raw scan file, failing with a clear message if it is missing or isn't one. */
export function readRaw(out: string, date: string): RawScanFile {
  const p = rawPath(out, date);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(p, "utf8"));
  } catch (e) {
    throw new Error(`can't read raw scan file ${p}: ${(e as Error).message}. Run a scan first, or pass --date for an earlier one.`, {
      cause: e,
    });
  }
  const r = parsed as Partial<RawScanFile>;
  if (typeof r.date !== "string" || !Array.isArray(r.results) || !r.catalogMeta || !r.stats || !r.domainAudit || typeof r.perHost !== "number") {
    throw new Error(`${p} is not an x402-doctor raw scan file (missing date/results/catalogMeta/stats/domainAudit/perHost).`);
  }
  return r as RawScanFile;
}
