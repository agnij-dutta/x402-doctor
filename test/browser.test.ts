// Browser (CORS) readiness checks against the local fixture server: one pass and one fail route per
// check, plus the specific shapes seen in x402-foundation/x402#3722.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { doctor } from "../src/doctor.js";
import { evalEndpoint } from "../src/scan/browser-metrics.js";
import type { Report } from "../src/types.js";
import {
  BASE_SEPOLIA,
  GOOD_CORS,
  defaultRpcState,
  startMockRpc,
  startMockServer,
  v1Challenge,
  v2Challenge,
  type CorsSpec,
  type RouteSpec,
} from "./helpers/mocks.js";

let srv: Awaited<ReturnType<typeof startMockServer>>;
let rpc: Awaited<ReturnType<typeof startMockRpc>>;
const routes: Record<string, RouteSpec> = {};
const ORIGIN = "https://x402-doctor.example";

beforeAll(async () => {
  srv = await startMockServer(routes);
  rpc = await startMockRpc(defaultRpcState());
  const B = srv.base;
  const v2 = (path: string, cors: CorsSpec | false, extra: Partial<RouteSpec> = {}): RouteSpec => ({
    header: v2Challenge(`${B}${path}`),
    cors,
    ...extra,
  });
  const reflect: CorsSpec = { ...GOOD_CORS, allowOrigin: undefined, reflect: true, onlyWithOrigin: true };
  Object.assign(routes, {
    "/good": v2("/good", GOOD_CORS),
    "/reflect-vary": v2("/reflect-vary", { ...reflect, vary: "Accept-Encoding, Origin" }),
    "/reflect-novary": v2("/reflect-novary", reflect),
    "/dup-acao": v2("/dup-acao", { ...GOOD_CORS, duplicateAllowOrigin: true }),
    "/null-acao": v2("/null-acao", { ...GOOD_CORS, allowOrigin: "null" }),
    "/slash-acao": v2("/slash-acao", { ...GOOD_CORS, allowOrigin: "https://x402-doctor.example/" }),
    "/charged": v2("/charged", GOOD_CORS, { optionsStatus: 402, optionsChallenge: true }),
    "/charged-bare": v2("/charged-bare", GOOD_CORS, { optionsStatus: 402 }),
    "/cred-star": v2("/cred-star", { allowOrigin: "*", expose: "*", allowHeaders: "*", credentials: true, maxAge: "600" }),
    "/star-nocred": v2("/star-nocred", { allowOrigin: "*", expose: "*", allowHeaders: "*", maxAge: "600" }),
    "/post-no-ct": v2("/post-no-ct", { ...GOOD_CORS, allowHeaders: "PAYMENT-SIGNATURE" }),
    "/put-method": v2("/put-method", { ...GOOD_CORS, allowMethods: "GET, POST" }),
    "/put-method-ok": v2("/put-method-ok", { ...GOOD_CORS, allowMethods: "GET, PUT" }),
    "/v1-only": v2("/v1-only", { ...GOOD_CORS, allowHeaders: "X-PAYMENT, Content-Type" }),
    "/not-named": v2("/not-named", { ...GOOD_CORS, allowHeaders: "Content-Type" }),
    "/no-acah": v2("/no-acah", { ...GOOD_CORS, allowHeaders: undefined }),
    "/preflight-404": v2("/preflight-404", GOOD_CORS, { optionsStatus: 404 }),
    "/refused": v2("/refused", { ...GOOD_CORS, refuseOrigin: true }),
    "/restricted": v2("/restricted", { ...GOOD_CORS, allowOrigin: "https://app.example" }),
    "/none": v2("/none", false),
    "/preflight-only": v2("/preflight-only", { ...GOOD_CORS, preflightOnly: true }),
    "/strip": v2("/strip", GOOD_CORS, { stripChallengeWithOrigin: true }),
    "/no-expose": v2("/no-expose", { ...GOOD_CORS, expose: "X-Request-Id" }),
    "/cached": v2("/cached", GOOD_CORS, { headers: { "cache-control": "public, max-age=300", age: "42" } }),
    "/cacheable": v2("/cacheable", GOOD_CORS, { headers: { "cache-control": "public, max-age=60" } }),
    "/no-store": v2("/no-store", GOOD_CORS, { headers: { "cache-control": "no-store" } }),
    "/no-max-age": v2("/no-max-age", { ...GOOD_CORS, maxAge: undefined }),
    "/short-max-age": v2("/short-max-age", { ...GOOD_CORS, maxAge: "5" }),
    "/dual": {
      header: v2Challenge(`${B}/dual`),
      body: v1Challenge(`${B}/dual`),
      cors: { ...GOOD_CORS, expose: "PAYMENT-REQUIRED, PAYMENT-RESPONSE" },
    },
    "/dual-good": {
      header: v2Challenge(`${B}/dual-good`),
      body: v1Challenge(`${B}/dual-good`),
      cors: {
        ...GOOD_CORS,
        expose: "PAYMENT-REQUIRED, PAYMENT-RESPONSE, X-PAYMENT-RESPONSE",
        allowHeaders: "PAYMENT-SIGNATURE, X-PAYMENT, Content-Type",
      },
    },
  } satisfies Record<string, RouteSpec>);
});

afterAll(async () => {
  await srv.close();
  await rpc.close();
});

const run = (path: string, extra: Parameters<typeof doctor>[1] = {}): Promise<Report> =>
  doctor(`${srv.base}${path}`, { rpc: { [BASE_SEPOLIA]: rpc.url }, checkPublicFacilitators: false, timeoutMs: 5000, ...extra });
const get = (r: Report, id: string) => r.checks.find((c) => c.id === id);
const st = (r: Report, id: string) => get(r, id)?.status;
const browserFails = (r: Report) => r.checks.filter((c) => c.category === "browser" && c.status === "fail").map((c) => c.id);

describe("a browser-ready endpoint", () => {
  it("passes every browser check and is ready", async () => {
    const r = await run("/good");
    for (const id of [
      "cors.allow-origin",
      "cors.allow-origin-single",
      "handshake.cors-expose",
      "cors.expose-payment-response",
      "handshake.cors-preflight",
      "cors.preflight-not-charged",
      "cors.cache-control",
      "cors.preflight-max-age",
    ]) {
      expect([id, st(r, id)]).toEqual([id, "pass"]);
    }
    expect(get(r, "cors.vary-origin")).toBeUndefined(); // Allow-Origin is *, so Vary isn't needed
    expect(r.browser).toEqual({ status: "ready", failing: [] });
    expect(r.score).toBe(100);
    expect(r.checks.filter((c) => c.category === "browser").every((c) => c.category === "browser")).toBe(true);
  });
  it("records the probe evidence on cors.allow-origin, without the challenge value", async () => {
    const o = get(await run("/good"), "cors.allow-origin")!.data!.observed as Record<string, any>;
    expect(o.origin).toBe(ORIGIN);
    expect(o.p1.paymentRequired).toBe(true);
    expect(o.p2.allowOrigin).toBe("*");
    expect(o.p3.allowHeaders).toBe("PAYMENT-SIGNATURE, Content-Type");
    expect(o.p3.maxAge).toBe("600");
    expect(JSON.stringify(o)).not.toContain("eyJ"); // no base64 challenge copied into the evidence
  });
});

describe("cors.allow-origin (C1)", () => {
  it("no Allow-Origin: zero-penalty advisory, not browser-facing", async () => {
    const r = await run("/none");
    expect(st(r, "cors.allow-origin")).toBe("warn");
    expect(get(r, "cors.allow-origin")!.penalty).toBe(0);
    expect(browserFails(r)).toEqual([]);
    expect(r.browser?.status).toBe("not-browser-facing");
    expect(r.score).toBe(100);
  });
  it("CORS only on the preflight still counts as no Allow-Origin on the 402", async () => {
    const r = await run("/preflight-only");
    expect(r.browser?.status).toBe("not-browser-facing");
    expect(get(r, "handshake.cors-expose")!.data?.cors).toBe("none");
  });
  it("refusing browser origins (401/403 with Origin) is allowed: skipped, refused, no fails", async () => {
    const r = await run("/refused");
    expect(st(r, "cors.allow-origin")).toBe("skip");
    expect(get(r, "cors.allow-origin")!.message).toContain("allowed by the spec");
    expect(browserFails(r)).toEqual([]);
    expect(r.browser?.status).toBe("refused");
  });
  it("a fixed other origin is restricted, with a --origin hint; re-running as that origin makes it ready", async () => {
    const r = await run("/restricted");
    expect(st(r, "cors.allow-origin")).toBe("skip");
    expect(get(r, "cors.allow-origin")!.fix).toContain("--origin https://app.example");
    expect(browserFails(r)).toEqual([]);
    expect(r.browser?.status).toBe("restricted");
    const again = await run("/restricted", { corsOrigin: "https://app.example" });
    expect(again.browser?.status).toBe("ready");
  });
  it("reflecting the probe origin passes", async () => {
    const r = await run("/reflect-vary");
    expect(st(r, "cors.allow-origin")).toBe("pass");
    expect(get(r, "cors.allow-origin")!.data?.allowOrigin).toBe("reflected");
    expect(r.browser?.status).toBe("ready");
  });
  it('"null" and malformed origins fail', async () => {
    expect(st(await run("/null-acao"), "cors.allow-origin")).toBe("fail");
    const r = await run("/slash-acao");
    expect(st(r, "cors.allow-origin")).toBe("fail");
    expect(r.browser?.status).toBe("blocked");
  });
  it("`*` with Allow-Credentials: true warns", async () => {
    expect(st(await run("/cred-star"), "cors.allow-origin")).toBe("warn");
  });
});

describe("cors.allow-origin-single (C2)", () => {
  it("the #3722 `*, *` shape: duplicated Allow-Origin on the 402, clean preflight: C2 fails, C5 passes", async () => {
    const r = await run("/dup-acao");
    const c2 = get(r, "cors.allow-origin-single")!;
    expect(c2.status).toBe("fail");
    expect(c2.message).toContain("the 402's Allow-Origin");
    expect(c2.message).not.toContain("preflight's");
    expect(st(r, "handshake.cors-preflight")).toBe("pass");
    expect(r.browser).toEqual({ status: "blocked", failing: ["cors.allow-origin-single"] });
  });
  it("passes on a single value", async () => {
    expect(st(await run("/good"), "cors.allow-origin-single")).toBe("pass");
  });
});

describe("handshake.cors-expose (C3)", () => {
  it("fails when PAYMENT-REQUIRED is not exposed, with in-review upstream references", async () => {
    const r = await run("/no-expose");
    const c = get(r, "handshake.cors-expose")!;
    expect(c.status).toBe("fail");
    expect(c.data?.cors).toBe("no-expose");
    expect(c.fix).toContain("in review (x402-foundation/x402#3774)");
    expect(c.fix).toContain("#3794");
    expect(c.fix).toContain("#3809");
    expect(r.settlementBroken).toBe(false);
  });
  it("`*` does not expose anything on a credentialed response", async () => {
    const c = get(await run("/cred-star"), "handshake.cors-expose")!;
    expect(c.status).toBe("fail");
    expect(c.data?.reason).toBe("wildcard-credentialed");
  });
  it("`*` exposes on an uncredentialed response", async () => {
    expect(st(await run("/star-nocred"), "handshake.cors-expose")).toBe("pass");
  });
  it("fails when an edge strips PAYMENT-REQUIRED from cross-origin responses", async () => {
    const c = get(await run("/strip"), "handshake.cors-expose")!;
    expect(c.status).toBe("fail");
    expect(c.data?.reason).toBe("stripped-with-origin");
  });
});

describe("cors.expose-payment-response (C4)", () => {
  it("passes when named on the 402, and says the paid response wasn't checked", async () => {
    const c = get(await run("/good"), "cors.expose-payment-response")!;
    expect(c.status).toBe("pass");
    expect(c.message).toContain("the paid response itself was not checked");
  });
  it("dual-version endpoints also need X-PAYMENT-RESPONSE", async () => {
    const r = await run("/dual");
    expect(st(r, "cors.expose-payment-response")).toBe("warn");
    expect(get(r, "cors.expose-payment-response")!.data?.missing).toEqual(["X-PAYMENT-RESPONSE"]);
    expect(st(await run("/dual-good"), "cors.expose-payment-response")).toBe("pass");
  });
});

describe("handshake.cors-preflight (C5)", () => {
  const reason = async (path: string, extra: Parameters<typeof doctor>[1] = {}) => {
    const c = get(await run(path, extra), "handshake.cors-preflight")!;
    expect(c.status).toBe("fail");
    return c.data?.reason;
  };
  it("v1-only: a v2 endpoint that allows X-PAYMENT but not PAYMENT-SIGNATURE", async () => {
    expect(await reason("/v1-only")).toBe("v1-only");
  });
  it("not-named: the payment header is missing, or there is no Allow-Headers at all", async () => {
    expect(await reason("/not-named")).toBe("not-named");
    expect(await reason("/no-acah")).toBe("not-named");
  });
  it("credentialed `*` in Allow-Headers", async () => {
    expect(await reason("/cred-star")).toBe("wildcard-credentialed");
  });
  it("uncredentialed `*` in Allow-Headers passes", async () => {
    expect(st(await run("/star-nocred"), "handshake.cors-preflight")).toBe("pass");
  });
  it("a JSON POST whose preflight doesn't allow Content-Type", async () => {
    expect(await reason("/post-no-ct", { method: "POST" })).toBe("content-type");
    // GET retries don't send Content-Type, so the same headers are fine for GET
    expect(st(await run("/post-no-ct"), "handshake.cors-preflight")).toBe("pass");
  });
  it("a PUT route whose Allow-Methods omits PUT", async () => {
    expect(await reason("/put-method", { method: "PUT" })).toBe("method");
    expect(st(await run("/put-method-ok", { method: "PUT" }), "handshake.cors-preflight")).toBe("pass");
  });
  it("a 404 preflight: register OPTIONS", async () => {
    const c = get(await run("/preflight-404"), "handshake.cors-preflight")!;
    expect(c.data?.reason).toBe("non-2xx:404");
    expect(c.fix).toContain("Register `OPTIONS`");
  });
  it("dual-version endpoints must allow both payment headers", async () => {
    expect(await reason("/dual")).toBe("not-named");
    expect(st(await run("/dual-good"), "handshake.cors-preflight")).toBe("pass");
  });
});

describe("cors.preflight-not-charged (C6)", () => {
  it("the method-less route trap: a 402 preflight with a challenge fails C6, not C5", async () => {
    const r = await run("/charged");
    const c = get(r, "cors.preflight-not-charged")!;
    expect(c.status).toBe("fail");
    expect(c.message).toContain("the x402 middleware is charging the CORS preflight");
    expect(c.fix).toContain("in review (x402-foundation/x402#3738)");
    expect(st(r, "handshake.cors-preflight")).toBe("skip");
    expect(r.browser).toEqual({ status: "blocked", failing: ["cors.preflight-not-charged"] });
  });
  it("a bare 402 preflight still fails, with the weaker message", async () => {
    const c = get(await run("/charged-bare"), "cors.preflight-not-charged")!;
    expect(c.status).toBe("fail");
    expect(c.data?.chargedWithChallenge).toBe(false);
  });
});

describe("cors.vary-origin (C7)", () => {
  it("warns when the origin is reflected without Vary: Origin", async () => {
    const r = await run("/reflect-novary");
    expect(st(r, "cors.vary-origin")).toBe("warn");
    expect(r.browser?.status).toBe("ready"); // a caching hazard, not a blocker
  });
  it("passes with Vary: Origin", async () => {
    expect(st(await run("/reflect-vary"), "cors.vary-origin")).toBe("pass");
  });
});

describe("cors.cache-control (C8)", () => {
  it("fails a publicly cacheable 402 that was served from a cache (Age > 0)", async () => {
    expect(st(await run("/cached"), "cors.cache-control")).toBe("fail");
  });
  it("warns on a publicly cacheable 402", async () => {
    expect(st(await run("/cacheable"), "cors.cache-control")).toBe("warn");
  });
  it("passes no-store and a missing Cache-Control", async () => {
    expect(st(await run("/no-store"), "cors.cache-control")).toBe("pass");
    expect(st(await run("/good"), "cors.cache-control")).toBe("pass");
  });
});

describe("cors.preflight-max-age (C9)", () => {
  it("missing or short Max-Age is an advisory warn with no score impact", async () => {
    for (const p of ["/no-max-age", "/short-max-age"]) {
      const r = await run(p);
      expect(st(r, "cors.preflight-max-age")).toBe("warn");
      expect(get(r, "cors.preflight-max-age")!.penalty).toBe(0);
      expect(r.score).toBe(100);
      expect(r.browser?.status).toBe("ready");
    }
  });
});

describe("scoring and modes", () => {
  it("browser problems cost at most 20 points", async () => {
    // C1 warn (3) + C3 fail (10) + C5 fail (10) = 23, capped at 20
    const r = await run("/cred-star");
    expect(browserFails(r).length).toBe(2);
    expect(r.score).toBe(80);
    expect(r.verdict).toBe("fail");
    expect(r.settlementBroken).toBe(false);
  });
  it("--server-only sends no Origin and no preflight, and reports not-browser-facing", async () => {
    const before = srv.hits.length;
    const r = await run("/no-expose", { serverOnly: true });
    const hits = srv.hits.slice(before);
    expect(hits.some((h) => h.method === "OPTIONS")).toBe(false);
    expect(hits.some((h) => h.headers.origin)).toBe(false);
    expect(browserFails(r)).toEqual([]);
    expect(r.checks.filter((c) => c.category === "browser").map((c) => c.status)).toEqual(["skip"]);
    expect(r.browser?.status).toBe("not-browser-facing");
  });
  it("the Origin probe of a JSON POST carries Content-Type, like the unpaid request", async () => {
    const before = srv.hits.length;
    await run("/good", { method: "POST" });
    const withOrigin = srv.hits.slice(before).find((h) => h.method === "POST" && h.headers.origin);
    expect(withOrigin?.headers["content-type"]).toBe("application/json");
  });
  it("never sends payment headers on any browser probe", () => {
    for (const h of srv.hits) {
      expect(h.headers["payment-signature"]).toBeUndefined();
      expect(h.headers["x-payment"]).toBeUndefined();
    }
  });
});

describe("frozen metrics agree with the checks' recorded bucket", () => {
  it("legacy readable == data.cors ok/partial, and noExpose == no-expose, on every fixture", async () => {
    for (const path of Object.keys(routes)) {
      const r = await run(path);
      const e = evalEndpoint(r);
      const bucket = get(r, "handshake.cors-expose")?.data?.cors;
      expect([path, e.readable]).toEqual([path, bucket === "ok" || bucket === "partial"]);
      expect([path, e.noExpose]).toEqual([path, bucket === "no-expose"]);
      expect(e.strict).toBeDefined();
      // strict payable implies the endpoint is browser-ready, apart from restricted/refused endpoints
      if (e.strict!.payable) expect([path, r.browser?.status]).toEqual([path, "ready"]);
    }
  });
});
