import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { browserMetrics, metricsFromPublic } from "../src/scan/browser-metrics.js";
import { compareRaw } from "../src/scan/compare.js";
import type { RawScanFile } from "../src/scan/raw-file.js";
import type { Check, Report } from "../src/types.js";

const chk = (c: Partial<Check>): Check => ({ id: "x", category: "browser", status: "pass", title: "", message: "", ...c });

describe("frozen browser metrics, pinned to the 2026-10-04 scan", () => {
  it("reproduces the #3722 numbers from the committed scan/2026-10-04.json", () => {
    const agg = JSON.parse(readFileSync(new URL("../scan/2026-10-04.json", import.meta.url), "utf8"));
    const m = metricsFromPublic(agg);
    expect(m.live).toBe(1359);
    expect(m.corsOn).toBe(549);
    expect(m.noExpose).toBe(192);
    expect(m.noExposePct).toBe(14.1);
    expect(m.preflightBad).toBe(132);
    expect(m.preflightBadPct).toBe(9.7);
    expect(m.readable).toBe(357);
    expect(m.readablePct).toBe(26.3);
  });
  const rawPath = new URL("../scan/raw/2026-10-04.raw.json", import.meta.url);
  // The raw file is gitignored (per-endpoint data stays local), so this only runs where it exists.
  it.skipIf(!existsSync(rawPath))("reproduces 192 / 132 / 357 / 323 from the local raw file", () => {
    const raw = JSON.parse(readFileSync(rawPath, "utf8")) as RawScanFile;
    const m = browserMetrics(raw.results.map((r) => r.report));
    expect([m.live, m.corsOn, m.noExpose, m.preflightBad, m.readable, m.payable]).toEqual([1359, 549, 192, 132, 357, 323]);
    expect([m.readablePct, m.payablePct, m.readablePctOfCorsOn, m.payablePctOfCorsOn]).toEqual([26.3, 23.8, 65, 58.8]);
    expect(m.strict).toBeNull();
  });
});

describe("scan compare", () => {
  // 0.1.x-shaped reports: the bucket and statuses are all the frozen metrics need.
  const legacy = (bucket: string | null, preflight?: Check["status"], live = true): Report =>
    ({
      checks: [
        chk({
          id: "handshake.status-402",
          category: "handshake",
          status: live ? "pass" : "fail",
          data: live ? undefined : { status: 404 },
        }),
        ...(live && bucket
          ? [chk({ id: "handshake.cors-expose", status: bucket === "no-expose" ? "fail" : "warn", data: { cors: bucket } })]
          : []),
        ...(live && preflight ? [chk({ id: "handshake.cors-preflight", status: preflight })] : []),
      ],
      challenge: live ? { version: 2, source: "header", raw: {}, accepts: [] } : undefined,
      settlementBroken: false,
    }) as unknown as Report;
  const file = (date: string, rows: [string, Report][]): RawScanFile =>
    ({
      date,
      perHost: 1,
      catalogMeta: { fetchedAt: "", sources: {} },
      stats: {},
      domainAudit: {},
      results: rows.map(([url, report]) => ({ target: { url, host: new URL(url).host, method: "GET", sources: [] }, report })),
    }) as unknown as RawScanFile;
  const a = file("2026-01-01", [
    ["https://a.example/x", legacy("no-expose", "fail")],
    ["https://b.example/x", legacy("ok", "pass")],
    ["https://c.example/x", legacy("none")],
    ["https://d.example/x", legacy("ok", "pass")],
    ["https://e.example/x", legacy("ok", "pass")],
  ]);
  const b = file("2026-02-01", [
    ["https://a.example/x", legacy("ok", "pass")],
    ["https://b.example/x", legacy("ok", "fail")],
    ["https://c.example/x", legacy("none")],
    ["https://d.example/x", legacy(null, undefined, false)],
    ["https://f.example/x", legacy("partial", "pass")],
  ]);
  const c = compareRaw(a, b);
  it("pairs by URL and counts transitions on the panel", () => {
    expect(c.panel.endpoints).toBe(3);
    expect(c.panel.transitions.payable).toEqual({ gained: 1, lost: 1, kept: 0, never: 1 });
    expect(c.panel.transitions.noExpose).toEqual({ gained: 0, lost: 1, kept: 0, never: 2 });
    expect(c.panel.checks).toBeNull(); // no probe evidence in either file
  });
  it("reports churn separately, so a dying endpoint is never a fix", () => {
    expect(c.churn).toEqual({ noLongerLive: 1, newlyLive: 1, notReprobed: 1, newTargets: 1 });
    expect(c.all.from.live).toBe(5);
    expect(c.all.to.live).toBe(4);
  });
  it("carries counts only, no URLs or hosts", () => {
    expect(JSON.stringify(c)).not.toMatch(/example/);
  });
});
