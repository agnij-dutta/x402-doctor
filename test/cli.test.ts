import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import type { Report } from "../src/types.js";
import { BASE_SEPOLIA, GOOD_CORS, defaultRpcState, startMockRpc, startMockServer, v2Challenge, type RouteSpec } from "./helpers/mocks.js";

const routes: Record<string, RouteSpec> = {};
let srv: Awaited<ReturnType<typeof startMockServer>>;
let rpc: Awaited<ReturnType<typeof startMockRpc>>;

beforeAll(async () => {
  srv = await startMockServer(routes);
  rpc = await startMockRpc(defaultRpcState());
  routes["/good"] = { header: v2Challenge(`${srv.base}/good`), cors: GOOD_CORS };
  routes["/bad"] = { header: v2Challenge(`${srv.base}/bad`, {}, { name: "USD Coin" }), cors: GOOD_CORS };
  routes["/busy"] = { status: 429 };
  routes["/no-expose"] = { header: v2Challenge(`${srv.base}/no-expose`), cors: { ...GOOD_CORS, expose: "X-Request-Id" } };
  routes["/app-only"] = { header: v2Challenge(`${srv.base}/app-only`), cors: { ...GOOD_CORS, allowOrigin: "https://app.example" } };
});
afterAll(async () => {
  await srv.close();
  await rpc.close();
});

function cli(args: string[]): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ["--import", "tsx", "src/cli.ts", ...args, "--rpc", `${BASE_SEPOLIA}=${rpc.url}`, "--timeout", "5000"],
      { env: { ...process.env, NO_COLOR: "1" } },
      (err, stdout) => {
        resolve({ code: err ? ((err as any).code as number) : 0, stdout });
      },
    );
  });
}

describe("cli", () => {
  it("exits 0 for a healthy endpoint", async () => {
    const r = await cli([`${srv.base}/good`]);
    expect(r.stdout).toContain("SETTLEMENT-READY");
    expect(r.code).toBe(0);
  });
  it("exits 1 and prints the fix for a domain mismatch", async () => {
    const r = await cli([`${srv.base}/bad`]);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("PAYMENTS WILL FAIL");
    expect(r.stdout).toContain('name: "USDC"');
  });
  it("--json emits a machine-readable report", async () => {
    const r = await cli([`${srv.base}/bad`, "--json"]);
    const j = JSON.parse(r.stdout) as Report;
    expect(j.settlementBroken).toBe(true);
    expect(j.checks.find((c) => c.id === "asset.eip712-domain")?.status).toBe("fail");
  });
  it("exits 2 when inconclusive", async () => {
    expect((await cli([`${srv.base}/busy`])).code).toBe(2);
  });
  it("--min-score lets CI tolerate failures above a threshold", async () => {
    expect((await cli([`${srv.base}/bad`, "--min-score", "10"])).code).toBe(0);
  });
  it("prints a browser verdict line", async () => {
    expect((await cli([`${srv.base}/good`])).stdout).toMatch(/browser\s+READY/);
    const r = await cli([`${srv.base}/no-expose`]);
    expect(r.stdout).toMatch(/browser\s+BLOCKED: PAYMENT-REQUIRED not exposed/);
    expect(r.stdout).toContain("Browser (CORS)");
    expect(r.code).toBe(1);
  });
  it("--server-only skips the browser checks (and their failures)", async () => {
    const r = await cli([`${srv.base}/no-expose`, "--server-only", "--json"]);
    const j = JSON.parse(r.stdout) as Report;
    expect(j.browser?.status).toBe("not-browser-facing");
    expect(j.score).toBe(100);
    expect(r.code).toBe(0);
  });
  it("--origin probes as the given origin", async () => {
    const r = await cli([`${srv.base}/app-only`, "--origin", "https://app.example/", "--json"]);
    expect((JSON.parse(r.stdout) as Report).browser?.status).toBe("ready");
    expect((await cli([`${srv.base}/app-only`, "--origin", "not a url"])).code).toBe(64);
    expect((await cli([`${srv.base}/app-only`, "--origin", "file:///etc"])).code).toBe(64);
  });
  it("--json output is complete when piped (no truncation at exit)", async () => {
    const r = await cli([`${srv.base}/good`, `${srv.base}/no-expose`, `${srv.base}/bad`, "--json"]);
    expect((JSON.parse(r.stdout) as Report[]).length).toBe(3);
  });
  it('"--" ends options, so a flag-looking URL is rejected as a URL, not parsed as a flag (action input safety)', async () => {
    const run = (args: string[]) =>
      new Promise<number>((resolve) =>
        execFile(process.execPath, ["--import", "tsx", "src/cli.ts", ...args], { env: { ...process.env, NO_COLOR: "1" } }, (err) =>
          resolve(err ? ((err as any).code as number) : 0),
        ),
      );
    expect(await run(["--rpc", `${BASE_SEPOLIA}=${rpc.url}`, "--timeout", "5000", "--", `${srv.base}/good`])).toBe(0);
    expect(await run(["--timeout", "5000", "--", "--strict", `${srv.base}/good`])).toBe(64);
  });
});
