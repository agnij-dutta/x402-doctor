import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { doctor } from "../src/doctor.js";
import { SELECTORS } from "../src/evm.js";
import type { Report } from "../src/types.js";
import {
  BASE_SEPOLIA,
  CONTRACT_PAY_TO,
  GATEWAY_WALLET,
  GOOD_CORS,
  GOOD_CORS_V1,
  NO_3009_TOKEN,
  PAY_TO,
  SOL_DEVNET,
  USDC_SOL_DEVNET,
  defaultRpcState,
  startMockRpc,
  startMockServer,
  v1Challenge,
  v2Challenge,
  type RouteSpec,
} from "./helpers/mocks.js";

/** The fee payer /svm-good declares, and a second one the mock facilitators manage. */
const SVM_FEE_PAYER = "CKPKJWNdJEqa81x7CkZ14BVPiY6y16Sxs7owznqtWYp5";
const OTHER_FEE_PAYER = "6XcSfqJHr9vNW2vbiRaMqUYVm7shDgLepca54wUTDPN5";

let srv: Awaited<ReturnType<typeof startMockServer>>;
let rpc: Awaited<ReturnType<typeof startMockRpc>>;
const rpcState = defaultRpcState();
const routes: Record<string, RouteSpec> = {};
const u = (p: string) => `${srv.base}${p}`;

beforeAll(async () => {
  srv = await startMockServer(routes);
  rpc = await startMockRpc(rpcState);
  // routes need the real base url for resource.url, so define after the server is up
  const B = srv.base;
  Object.assign(routes, {
    "/good-v2": { header: v2Challenge(`${B}/good-v2`), cors: GOOD_CORS },
    "/good-v1": { body: v1Challenge(`${B}/good-v1`), cors: GOOD_CORS_V1 },
    "/domain-mismatch": { header: v2Challenge(`${B}/domain-mismatch`, {}, { name: "USD Coin" }), cors: GOOD_CORS },
    "/version-mismatch": { header: v2Challenge(`${B}/version-mismatch`, {}, { version: "1" }), cors: GOOD_CORS },
    "/no-cors-expose": { header: v2Challenge(`${B}/no-cors-expose`), cors: { allowOrigin: "*", allowHeaders: "PAYMENT-SIGNATURE" } },
    "/no-cors": { header: v2Challenge(`${B}/no-cors`), cors: false },
    "/partial-cors": {
      header: v2Challenge(`${B}/partial-cors`),
      cors: { allowOrigin: "*", expose: "PAYMENT-REQUIRED", allowHeaders: "PAYMENT-SIGNATURE" },
    },
    "/preflight-blocks": {
      header: v2Challenge(`${B}/preflight-blocks`),
      cors: { allowOrigin: "*", expose: "PAYMENT-REQUIRED, PAYMENT-RESPONSE", allowHeaders: "Content-Type" },
    },
    "/amount-decimal": { header: v2Challenge(`${B}/amount-decimal`, { amount: "0.01" }), cors: GOOD_CORS },
    "/amount-number": { header: v2Challenge(`${B}/amount-number`, { amount: 10000 }), cors: GOOD_CORS },
    "/v1-field-in-v2": {
      header: (() => {
        const c = v2Challenge(`${B}/v1-field-in-v2`);
        const { amount, ...rest } = c.accepts[0]!;
        return { ...c, accepts: [{ ...rest, maxAmountRequired: amount }] };
      })(),
      cors: GOOD_CORS,
    },
    "/v1-name-in-v2": { header: v2Challenge(`${B}/v1-name-in-v2`, { network: "base-sepolia" }), cors: GOOD_CORS },
    "/bad-v1": {
      body: v1Challenge(`${B}/bad-v1`, { maxAmountRequired: undefined, amount: "10000", network: BASE_SEPOLIA }),
      cors: GOOD_CORS_V1,
    },
    "/v2-body-only": { body: v2Challenge(`${B}/v2-body-only`), cors: GOOD_CORS },
    "/base64url": {
      header: v2Challenge(`${B}/base64url`, {}, { name: "USDC", memo: "ÿþ>>>???" }),
      headerEncoding: "base64url",
      cors: GOOD_CORS,
    },
    "/garbage-header": { headerRaw: "not base64 at all!", cors: GOOD_CORS },
    "/free": { status: 200, body: { data: "free stuff" } },
    "/rate-limited": { status: 429, body: { error: "slow down" } },
    "/zero-payto": { header: v2Challenge(`${B}/zero-payto`, { payTo: "0x0000000000000000000000000000000000000000" }), cors: GOOD_CORS },
    "/contract-payto": { header: v2Challenge(`${B}/contract-payto`, { payTo: CONTRACT_PAY_TO }), cors: GOOD_CORS },
    "/missing-asset": {
      header: v2Challenge(`${B}/missing-asset`, {
        asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        extra: { name: "USD Coin", version: "2" },
      }),
      cors: GOOD_CORS,
    },
    "/no-3009": {
      header: v2Challenge(`${B}/no-3009`, { asset: NO_3009_TOKEN, amount: "10000000000000000" }, { name: "Plain Token", version: "1" }),
      cors: GOOD_CORS,
    },
    "/missing-extra": { header: v2Challenge(`${B}/missing-extra`, { extra: {} }), cors: GOOD_CORS },
    "/head-free": { header: v2Challenge(`${B}/head-free`), cors: GOOD_CORS, headStatus: 200 },
    "/wrong-resource": { header: v2Challenge(`${B}/somewhere-else`), cors: GOOD_CORS },
    "/short-timeout": { header: v2Challenge(`${B}/short-timeout`, { maxTimeoutSeconds: 3 }), cors: GOOD_CORS },
    "/svm-good": {
      header: {
        x402Version: 2,
        resource: { url: `${B}/svm-good` },
        accepts: [
          {
            scheme: "exact",
            network: SOL_DEVNET,
            amount: "1000",
            asset: USDC_SOL_DEVNET,
            payTo: "6XcSfqJHr9vNW2vbiRaMqUYVm7shDgLepca54wUTDPN5",
            maxTimeoutSeconds: 60,
            extra: { feePayer: "CKPKJWNdJEqa81x7CkZ14BVPiY6y16Sxs7owznqtWYp5" },
          },
        ],
      },
      cors: GOOD_CORS,
    },
    "/svm-no-feepayer": {
      header: {
        x402Version: 2,
        resource: { url: `${B}/svm-no-feepayer` },
        accepts: [
          {
            scheme: "exact",
            network: SOL_DEVNET,
            amount: "1000",
            asset: USDC_SOL_DEVNET,
            payTo: "6XcSfqJHr9vNW2vbiRaMqUYVm7shDgLepca54wUTDPN5",
            maxTimeoutSeconds: 60,
            extra: {},
          },
        ],
      },
      cors: GOOD_CORS,
    },
    "/svm-evm-payto": {
      header: {
        x402Version: 2,
        resource: { url: `${B}/svm-evm-payto` },
        accepts: [
          {
            scheme: "exact",
            network: SOL_DEVNET,
            amount: "1000",
            asset: USDC_SOL_DEVNET,
            payTo: "0x209693Bc6afc0C5328bA36FaF03C514EF312287C",
            maxTimeoutSeconds: 60,
            extra: { feePayer: "CKPKJWNdJEqa81x7CkZ14BVPiY6y16Sxs7owznqtWYp5" },
          },
        ],
      },
      cors: GOOD_CORS,
    },
    "/mpp": { status: 402, body: {} },
    // --- regressions from the 2026-10-04 public scan (false positives) ---
    "/gateway-batched": {
      header: v2Challenge(`${B}/gateway-batched`, {}, { name: "GatewayWalletBatched", version: "1", verifyingContract: GATEWAY_WALLET }),
      cors: GOOD_CORS,
    },
    "/gateway-match": {
      header: v2Challenge(`${B}/gateway-match`, {}, { name: "GatewayWallet", version: "1", verifyingContract: GATEWAY_WALLET }),
      cors: GOOD_CORS,
    },
    "/xrpl-decimal": {
      header: {
        x402Version: 2,
        resource: { url: `${B}/xrpl-decimal` },
        accepts: [
          {
            scheme: "exact",
            network: "xrpl:0",
            amount: "0.1",
            asset: "524C555344000000000000000000000000000000",
            payTo: "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De",
            maxTimeoutSeconds: 60,
            extra: {},
          },
        ],
      },
      cors: GOOD_CORS,
    },
    "/algorand-net": {
      header: {
        x402Version: 2,
        resource: { url: `${B}/algorand-net` },
        accepts: [
          {
            scheme: "exact",
            network: "algorand:wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=",
            amount: "10000",
            asset: "31566704",
            payTo: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
            maxTimeoutSeconds: 60,
            extra: {},
          },
        ],
      },
      cors: GOOD_CORS,
    },
    "/permit2-exact": { header: v2Challenge(`${B}/permit2-exact`, {}, { assetTransferMethod: "permit2-exact" }), cors: GOOD_CORS },
    "/vercel-disabled": {
      status: 402,
      bodyRaw: "Payment required\n\nDEPLOYMENT_DISABLED\n\nbom1::abc-123\n",
      headers: { "x-vercel-error": "DEPLOYMENT_DISABLED" },
    },
    "/facilitator/supported": { status: 200, body: { kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:8453" }] } },
    // --- regressions from the independent review (false positives / negatives) ---
    "/hyperliquid-net": {
      header: {
        x402Version: 2,
        resource: { url: `${B}/hyperliquid-net` },
        accepts: [
          {
            scheme: "exact",
            network: "hyperliquid:mainnet",
            amount: "10000",
            asset: "USDC",
            payTo: PAY_TO,
            maxTimeoutSeconds: 60,
            extra: {},
          },
        ],
      },
      cors: GOOD_CORS,
    },
    "/v1-empty-description": { body: v1Challenge(`${B}/v1-empty-description`, { description: "" }), cors: GOOD_CORS_V1 },
    "/preflight-402": { header: v2Challenge(`${B}/preflight-402`), cors: GOOD_CORS, optionsStatus: 402 },
    "/fac-rotating/supported": {
      status: 200,
      body: {
        kinds: [{ x402Version: 2, scheme: "exact", network: SOL_DEVNET, extra: { feePayer: OTHER_FEE_PAYER } }],
        signers: { "solana:*": [OTHER_FEE_PAYER, SVM_FEE_PAYER] },
      },
    },
    "/fac-foreign/supported": {
      status: 200,
      body: {
        kinds: [{ x402Version: 2, scheme: "exact", network: SOL_DEVNET, extra: { feePayer: OTHER_FEE_PAYER } }],
        signers: { "solana:*": [OTHER_FEE_PAYER] },
      },
    },
    "/fac-unlisted/supported": {
      status: 200,
      body: { kinds: [{ x402Version: 2, scheme: "exact", network: SOL_DEVNET, extra: { feePayer: OTHER_FEE_PAYER } }] },
    },
  } satisfies Record<string, RouteSpec>);
});

afterAll(async () => {
  await srv.close();
  await rpc.close();
});

async function run(path: string, extra: Parameters<typeof doctor>[1] = {}): Promise<Report> {
  return doctor(u(path), {
    rpc: { [BASE_SEPOLIA]: rpc.url, [SOL_DEVNET]: rpc.url },
    checkPublicFacilitators: false,
    timeoutMs: 5000,
    ...extra,
  });
}
const get = (r: Report, id: string) => r.checks.filter((c) => c.id === id);
const status = (r: Report, id: string) => get(r, id).map((c) => c.status);

describe("good endpoints", () => {
  it("v2 good endpoint passes everything", async () => {
    const r = await run("/good-v2");
    const bad = r.checks.filter((c) => c.status === "fail" || c.status === "warn" || c.status === "unknown");
    expect(bad).toEqual([]);
    expect(r.verdict).toBe("pass");
    expect(r.score).toBe(100);
    expect(r.version).toBe(2);
    expect(r.prices[0]?.human).toBe("$0.01");
    expect(status(r, "asset.eip712-domain")).toEqual(["pass"]);
    expect(get(r, "asset.eip712-domain")[0]!.data?.source).toBe("DOMAIN_SEPARATOR()");
  });

  it("never sends payment headers", async () => {
    await run("/good-v2");
    for (const h of srv.hits) {
      expect(h.headers["payment-signature"]).toBeUndefined();
      expect(h.headers["x-payment"]).toBeUndefined();
      expect(h.headers["authorization"]).toBeUndefined();
    }
    expect(srv.hits.every((h) => ["GET", "HEAD", "OPTIONS"].includes(h.method))).toBe(true);
  });

  it("v1 good endpoint passes with a legacy-version warning only", async () => {
    const r = await run("/good-v1");
    expect(r.version).toBe(1);
    expect(r.checks.filter((c) => c.status === "fail")).toEqual([]);
    expect(status(r, "handshake.version")).toEqual(["warn"]);
    expect(status(r, "asset.eip712-domain")).toEqual(["pass"]);
    expect(r.verdict).toBe("warn");
    expect(r.settlementBroken).toBe(false);
  });

  it("solana endpoint passes mint checks", async () => {
    const r = await run("/svm-good");
    expect(r.checks.filter((c) => c.status === "fail")).toEqual([]);
    expect(status(r, "asset.exists")).toEqual(["pass"]);
    expect(r.prices[0]?.human).toBe("$0.001");
  });
});

describe("the #1 failure: EIP-712 domain mismatch", () => {
  it("flags mainnet name 'USD Coin' on Base Sepolia USDC (which is 'USDC')", async () => {
    const r = await run("/domain-mismatch");
    const c = get(r, "asset.eip712-domain")[0]!;
    expect(c.status).toBe("fail");
    expect(c.critical).toBe(true);
    expect(c.message).toContain('extra.name is "USD Coin" but the token\'s EIP-712 name is "USDC"');
    expect(c.fix).toContain('name: "USDC", version: "2"');
    expect(r.settlementBroken).toBe(true);
    expect(r.noWorkingOption).toBe(true);
    expect(r.score).toBeLessThan(50);
  });

  it("diagnoses a wrong version", async () => {
    const r = await run("/version-mismatch");
    const c = get(r, "asset.eip712-domain")[0]!;
    expect(c.status).toBe("fail");
    expect(c.message).toContain('extra.version is "1" but the token\'s EIP-712 version is "2"');
  });

  it("offline mode falls back to the verified table", async () => {
    const r = await doctor(u("/domain-mismatch"), { offline: true, timeoutMs: 5000 });
    expect(status(r, "asset.eip712-domain")).toEqual(["fail"]);
    expect(get(r, "asset.eip712-domain")[0]!.data?.source).toBe("table");
  });
});

describe("CORS", () => {
  it("fails when CORS is on but PAYMENT-REQUIRED isn't exposed", async () => {
    const r = await run("/no-cors-expose");
    const c = get(r, "handshake.cors-expose")[0]!;
    expect(c.status).toBe("fail");
    expect(c.fix).toContain("Access-Control-Expose-Headers: PAYMENT-REQUIRED, PAYMENT-RESPONSE");
    expect(r.settlementBroken).toBe(false); // agents can still pay; browsers can't
  });
  it("warns when there's no CORS at all", async () => {
    expect(status(await run("/no-cors"), "handshake.cors-expose")).toEqual(["warn"]);
  });
  it("warns when only PAYMENT-RESPONSE is missing", async () => {
    expect(status(await run("/partial-cors"), "handshake.cors-expose")).toEqual(["warn"]);
  });
  it("fails when the preflight doesn't allow PAYMENT-SIGNATURE", async () => {
    expect(status(await run("/preflight-blocks"), "handshake.cors-preflight")).toEqual(["fail"]);
  });
});

describe("schema", () => {
  it("rejects a decimal dollar amount with the atomic conversion as fix", async () => {
    const r = await run("/amount-decimal");
    const c = get(r, "schema.amount-format")[0]!;
    expect(c.status).toBe("fail");
    expect(c.critical).toBe(true);
    expect(c.fix).toContain('"10000"');
  });
  it("rejects a JSON number amount", async () => {
    expect(status(await run("/amount-number"), "schema.amount-format")).toEqual(["fail"]);
  });
  it("flags v1 maxAmountRequired inside a v2 challenge", async () => {
    const r = await run("/v1-field-in-v2");
    expect(status(r, "schema.amount-field")).toEqual(["fail"]);
  });
  it("flags v1 network names in v2 and suggests CAIP-2", async () => {
    const c = get(await run("/v1-name-in-v2"), "schema.network")[0]!;
    expect(c.status).toBe("fail");
    expect(c.fix).toContain("eip155:84532");
  });
  it("flags v2 fields in a v1 body", async () => {
    const r = await run("/bad-v1");
    expect(status(r, "schema.amount-field")).toEqual(["fail"]);
    expect(status(r, "schema.network")).toEqual(["fail"]);
  });
  it("flags missing EIP-712 extra", async () => {
    expect(status(await run("/missing-extra"), "schema.eip712-extra")).toEqual(["fail"]);
  });
  it("warns on resource URL mismatch", async () => {
    expect(status(await run("/wrong-resource"), "schema.resource-url")).toEqual(["warn"]);
  });
  it("warns on a very short maxTimeoutSeconds", async () => {
    expect(status(await run("/short-timeout"), "schema.timeout")).toEqual(["warn"]);
  });
  it("requires feePayer for Solana exact", async () => {
    expect(status(await run("/svm-no-feepayer"), "schema.svm-feepayer")).toEqual(["fail"]);
  });
});

describe("handshake", () => {
  it("v2 challenge only in the body fails (reference clients won't read it)", async () => {
    const r = await run("/v2-body-only");
    expect(status(r, "handshake.challenge-decode")).toEqual(["fail"]);
    expect(r.settlementBroken).toBe(true);
  });
  it("base64url header fails (reference client regex rejects - and _)", async () => {
    const r = await run("/base64url");
    const c = get(r, "handshake.challenge-decode")[0]!;
    expect(c.status).toBe("fail");
    expect(c.message).toContain("base64url");
  });
  it("garbage header fails", async () => {
    expect(status(await run("/garbage-header"), "handshake.challenge-decode")).toEqual(["fail"]);
  });
  it("200 to an unpaid request fails with score 0", async () => {
    const r = await run("/free");
    expect(status(r, "handshake.status-402")).toEqual(["fail"]);
    expect(r.score).toBe(0);
  });
  it("429 is inconclusive, not a failure", async () => {
    const r = await run("/rate-limited");
    expect(status(r, "handshake.status-402")).toEqual(["unknown"]);
    expect(r.verdict).toBe("unknown");
    expect(r.settlementBroken).toBe(false);
  });
  it("402 with no x402 challenge fails", async () => {
    expect(status(await run("/mpp"), "handshake.challenge-decode")).toEqual(["fail"]);
  });
  it("warns when HEAD is served without payment", async () => {
    expect(status(await run("/head-free"), "handshake.head")).toEqual(["warn"]);
  });
  it("unreachable host is inconclusive", async () => {
    const r = await doctor("http://127.0.0.1:1/x", { timeoutMs: 2000, checkPublicFacilitators: false });
    expect(r.verdict).toBe("unknown");
  });
});

describe("asset + payTo on-chain", () => {
  it("fails a zero payTo", async () => {
    expect(status(await run("/zero-payto"), "payTo.valid")).toEqual(["fail"]);
  });
  it("warns when payTo is a contract", async () => {
    expect(status(await run("/contract-payto"), "payTo.contract")).toEqual(["warn"]);
  });
  it("fails when the asset has no code on the declared network, and names the right network", async () => {
    const c = get(await run("/missing-asset"), "asset.exists")[0]!;
    expect(c.status).toBe("fail");
    expect(c.message).toContain("USDC on Base");
    expect(c.fix).toContain("eip155:8453");
  });
  it("fails eip3009 on a token without transferWithAuthorization", async () => {
    const r = await run("/no-3009");
    expect(status(r, "asset.eip3009")).toEqual(["fail"]);
    expect(get(r, "asset.eip3009")[0]!.fix).toContain("permit2");
  });
  it("fails Solana payTo that is an EVM address", async () => {
    expect(status(await run("/svm-evm-payto"), "payTo.valid")).toEqual(["fail"]);
  });
  it("RPC outage is inconclusive, not a failure", async () => {
    rpcState.failAll = true;
    try {
      const r = await run("/good-v2");
      expect(status(r, "asset.exists")).toEqual(["unknown"]);
      expect(r.checks.filter((c) => c.status === "fail")).toEqual([]);
    } finally {
      rpcState.failAll = false;
    }
  });
});

describe("scan false-positive regressions", () => {
  it("separate verifyingContract (Circle Gateway batched) is inconclusive, never a settlement failure", async () => {
    const r = await run("/gateway-batched");
    const c = get(r, "asset.eip712-domain")[0]!;
    expect(c.status).toBe("unknown");
    expect(c.message).toContain("GatewayWallet");
    expect(r.settlementBroken).toBe(false);
  });
  it("separate verifyingContract is checked against that contract, not the token", async () => {
    const c = get(await run("/gateway-match"), "asset.eip712-domain")[0]!;
    expect(c.status).toBe("pass");
    expect(c.message).toContain("verifyingContract");
  });
  it("does not apply the EVM atomic-integer amount rule to XRPL", async () => {
    const r = await run("/xrpl-decimal");
    expect(status(r, "schema.amount-format")).toEqual(["skip"]);
    expect(r.settlementBroken).toBe(false);
  });
  it("namespace:reference networks that miss strict CAIP-2 warn instead of being called v1 names", async () => {
    const c = get(await run("/algorand-net"), "schema.network")[0]!;
    expect(c.status).toBe("warn");
    expect(c.message).not.toContain("v1 name");
  });
  it("unknown assetTransferMethod extensions warn, not fail", async () => {
    const r = await run("/permit2-exact");
    expect(status(r, "schema.transfer-method")).toEqual(["warn"]);
  });
  it("a Vercel DEPLOYMENT_DISABLED 402 is attributed to the platform, not x402", async () => {
    const r = await run("/vercel-disabled");
    const c = get(r, "handshake.status-402")[0]!;
    expect(c.status).toBe("fail");
    expect(c.data?.platform).toBe("vercel:DEPLOYMENT_DISABLED");
    expect(get(r, "handshake.challenge-decode")).toEqual([]);
  });
});

describe("facilitator", () => {
  it("fails when the facilitator doesn't support the scheme/network", async () => {
    const r = await run("/good-v2", { facilitator: u("/facilitator") });
    const c = get(r, "facilitator.supported")[0]!;
    expect(c.status).toBe("fail");
    expect(c.message).toContain("eip155:84532");
  });
});

describe("independent review regressions", () => {
  it("a v2 namespace:reference id with a long namespace warns, it is not a v1 name", async () => {
    const r = await run("/hyperliquid-net");
    const c = get(r, "schema.network")[0]!;
    expect(c.status).toBe("warn");
    expect(c.message).not.toContain("v1 name");
    expect(r.settlementBroken).toBe(false);
  });
  it("still fails a bare v1 name in v2", async () => {
    expect(status(await run("/v1-name-in-v2"), "schema.network")).toEqual(["fail"]);
  });
  it("an empty v1 description is present, not missing", async () => {
    const r = await run("/v1-empty-description");
    expect(status(r, "schema.required-fields")).toEqual(["pass"]);
  });
  it("a non-2xx preflight fails even with the right headers", async () => {
    const c = get(await run("/preflight-402"), "handshake.cors-preflight")[0]!;
    expect(c.status).toBe("fail");
    expect(c.message).toContain("402");
    expect(status(await run("/good-v2"), "handshake.cors-preflight")).toEqual(["pass"]);
  });
  it("a fee payer from the facilitator's signer list passes even if /supported advertised another", async () => {
    const r = await run("/svm-good", { facilitator: u("/fac-rotating") });
    expect(status(r, "facilitator.supported")).toEqual(["pass"]);
    expect(status(r, "facilitator.feepayer")).toEqual(["pass"]);
    expect(r.settlementBroken).toBe(false);
  });
  it("a fee payer the facilitator doesn't manage still fails", async () => {
    const r = await run("/svm-good", { facilitator: u("/fac-foreign") });
    const c = get(r, "facilitator.feepayer")[0]!;
    expect(c.status).toBe("fail");
    expect(c.critical).toBe(true);
  });
  it("a different fee payer with no signers list is inconclusive, not a failure", async () => {
    const r = await run("/svm-good", { facilitator: u("/fac-unlisted") });
    expect(status(r, "facilitator.feepayer")).toEqual(["unknown"]);
    expect(r.settlementBroken).toBe(false);
  });
  it("an RPC-side eth_call timeout is inconclusive, not a missing EIP-3009", async () => {
    rpcState.abortSelectors = new Set([SELECTORS.authorizationState]);
    try {
      const r = await run("/good-v2");
      expect(status(r, "asset.eip3009")).toEqual(["unknown"]);
      expect(r.checks.filter((c) => c.status === "fail")).toEqual([]);
    } finally {
      rpcState.abortSelectors = undefined;
    }
  });
  it("when DOMAIN_SEPARATOR() errors, a name()/version() mismatch is inconclusive", async () => {
    rpcState.abortSelectors = new Set([SELECTORS.DOMAIN_SEPARATOR]);
    try {
      const r = await run("/domain-mismatch");
      const c = get(r, "asset.eip712-domain")[0]!;
      expect(c.status).toBe("unknown");
      expect(c.message).toContain("RPC error");
      expect(r.settlementBroken).toBe(false);
    } finally {
      rpcState.abortSelectors = undefined;
    }
    // with DOMAIN_SEPARATOR() answering, the same endpoint is a confirmed failure
    expect(status(await run("/domain-mismatch"), "asset.eip712-domain")).toEqual(["fail"]);
  });
});
