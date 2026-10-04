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
});
