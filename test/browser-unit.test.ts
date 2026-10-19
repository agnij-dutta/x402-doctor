import { describe, expect, it } from "vitest";
import { score, summarizeBrowser } from "../src/doctor.js";
import { checkCors, type CorsObserved, type ObservedResponse } from "../src/checks/cors.js";
import { FIX_REFS, refText } from "../src/checks/fixrefs.js";
import type { Check } from "../src/types.js";

const chk = (c: Partial<Check>): Check => ({ id: "x", category: "browser", status: "pass", title: "", message: "", ...c });

describe("browser scoring", () => {
  it("caps the browser category at 20, whatever the number of failures", () => {
    const three = [chk({ id: "a", status: "fail" }), chk({ id: "b", status: "fail" }), chk({ id: "c", status: "fail" })];
    expect(score(three)).toBe(80);
    expect(score([...three, chk({ id: "d", category: "schema", status: "fail" })])).toBe(70);
  });
  it("a penalty: 0 advisory never moves the score", () => {
    expect(score([chk({ status: "warn", penalty: 0 })])).toBe(100);
    expect(score([chk({ status: "warn" })])).toBe(97);
  });
  it("the cap doesn't hide settlement-blocking failures elsewhere", () => {
    expect(score([chk({ status: "fail" }), chk({ id: "s", category: "asset", status: "fail", critical: true })])).toBe(49);
  });
});

describe("summarizeBrowser", () => {
  const core = (over: Record<string, Check["status"]> = {}, c1Data: Record<string, unknown> = { allowOrigin: "star" }) =>
    [
      "cors.allow-origin",
      "cors.allow-origin-single",
      "handshake.cors-expose",
      "handshake.cors-preflight",
      "cors.preflight-not-charged",
    ].map((id) => chk({ id, status: over[id] ?? "pass", data: id === "cors.allow-origin" ? c1Data : undefined }));
  it("ready when every core check passes", () => {
    expect(summarizeBrowser(core())).toEqual({ status: "ready", failing: [] });
  });
  it("blocked lists the failing core checks", () => {
    expect(summarizeBrowser(core({ "handshake.cors-expose": "fail", "cors.preflight-not-charged": "fail" }))).toEqual({
      status: "blocked",
      failing: ["handshake.cors-expose", "cors.preflight-not-charged"],
    });
  });
  it("non-core warnings don't block", () => {
    expect(summarizeBrowser([...core(), chk({ id: "cors.vary-origin", status: "warn" })]).status).toBe("ready");
  });
  it("maps C1's not-judged outcomes", () => {
    expect(summarizeBrowser([chk({ id: "cors.allow-origin", status: "warn", data: { browser: "none" } })]).status).toBe(
      "not-browser-facing",
    );
    expect(summarizeBrowser([chk({ id: "cors.allow-origin", status: "skip", data: { browser: "server-only" } })]).status).toBe(
      "not-browser-facing",
    );
    expect(summarizeBrowser([chk({ id: "cors.allow-origin", status: "skip", data: { browser: "refused" } })]).status).toBe("refused");
    expect(summarizeBrowser(core({ "cors.allow-origin": "skip" }, { browser: "restricted" })).status).toBe("restricted");
    expect(summarizeBrowser([chk({ id: "cors.allow-origin", status: "skip", data: { browser: "unknown" } })]).status).toBe("unknown");
    expect(summarizeBrowser([]).status).toBe("unknown");
  });
  it("a failure that didn't reproduce (unknown) is not ready", () => {
    expect(summarizeBrowser(core({ "handshake.cors-preflight": "unknown" })).status).toBe("unknown");
  });
});

const resp = (o: Partial<ObservedResponse> = {}): ObservedResponse => ({
  status: 402,
  allowOrigin: null,
  allowCredentials: null,
  exposeHeaders: null,
  allowHeaders: null,
  allowMethods: null,
  maxAge: null,
  vary: null,
  cacheControl: null,
  age: null,
  cacheStatus: null,
  paymentRequired: true,
  ...o,
});
const obs = (p2: Partial<ObservedResponse>, p3: Partial<ObservedResponse>): CorsObserved => ({
  origin: "https://x402-doctor.example",
  method: "GET",
  version: 2,
  dual: false,
  p1: resp(),
  p2: resp({ allowOrigin: "*", exposeHeaders: "PAYMENT-REQUIRED, PAYMENT-RESPONSE", ...p2 }),
  p3: resp({ status: 204, paymentRequired: false, allowOrigin: "*", allowHeaders: "PAYMENT-SIGNATURE", maxAge: "600", ...p3 }),
});
const find = (cs: Check[], id: string) => cs.find((c) => c.id === id);

describe("checkCors (pure)", () => {
  it("names the preflight when only the preflight has a duplicated Allow-Origin", () => {
    const c2 = find(checkCors(obs({}, { allowOrigin: "*, *" })), "cors.allow-origin-single")!;
    expect(c2.status).toBe("fail");
    expect(c2.message).toContain("the preflight's Allow-Origin");
  });
  it("a duplicated Allow-Credentials (true, true) fails too", () => {
    expect(find(checkCors(obs({ allowCredentials: "true, true" }, {})), "cors.allow-origin-single")!.status).toBe("fail");
  });
  it("cache evidence from cf-cache-status counts as served from a cache", () => {
    const cs = checkCors(obs({ cacheControl: "public, s-maxage=30", cacheStatus: "HIT" }, {}));
    expect(find(cs, "cors.cache-control")!.status).toBe("fail");
  });
  it("private or no-cache 402s pass even with max-age", () => {
    expect(find(checkCors(obs({ cacheControl: "private, max-age=60" }, {})), "cors.cache-control")!.status).toBe("pass");
    expect(find(checkCors(obs({ cacheControl: "no-cache, max-age=60" }, {})), "cors.cache-control")!.status).toBe("pass");
  });
  it("an inconclusive Origin probe skips, and is unknown", () => {
    const cs = checkCors({ ...obs({}, {}), p2: resp({ status: 503 }) });
    expect(cs.map((c) => c.status)).toEqual(["skip", "skip"]);
    expect(summarizeBrowser(cs).status).toBe("unknown");
  });
});

describe("fix references", () => {
  it("say 'in review' until a version is released, then 'fixed in'", () => {
    expect(refText(FIX_REFS.exposeTs)).toBe("in review (x402-foundation/x402#3774)");
    expect(refText({ ...FIX_REFS.exposeTs, released: "2.3.0" })).toBe("fixed in @x402/express etc. >= 2.3.0 (x402-foundation/x402#3774)");
    for (const r of Object.values(FIX_REFS)) expect(r.released).toBeNull();
  });
});
