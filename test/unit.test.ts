import { describe, expect, it } from "vitest";
import { decodeEip712Domain, decodeString, domainSeparator, toChecksumAddress, checksumStatus } from "../src/evm.js";
import { decodeHeaderValue } from "../src/decode.js";
import { formatUnits } from "../src/checks/asset.js";
import { confirm } from "../src/scan/run.js";
import { outcomeOf } from "../src/scan/outcome.js";
import { selectTargets } from "../src/scan/discover.js";
import { score } from "../src/doctor.js";
import { isRevert } from "../src/rpc.js";
import { aggregate } from "../src/scan/aggregate.js";
import { abiString } from "./helpers/mocks.js";
import type { Check, Report } from "../src/types.js";

describe("evm helpers", () => {
  it("computes the real Base Sepolia USDC domain separator (verified on-chain)", () => {
    expect(domainSeparator("USDC", "2", 84532, "0x036CbD53842c5426634e7929541eC2318f3dCF7e")).toBe(
      "0x71f17a3b2ff373b803d70a5a07c046c1a2bc8e89c09ef722fcb047abe94c9818",
    );
    expect(domainSeparator("USD Coin", "2", 84532, "0x036CbD53842c5426634e7929541eC2318f3dCF7e")).not.toBe(
      "0x71f17a3b2ff373b803d70a5a07c046c1a2bc8e89c09ef722fcb047abe94c9818",
    );
  });
  it("decodes ABI strings and bytes32 strings", () => {
    expect(decodeString(abiString("USD Coin"))).toBe("USD Coin");
    expect(decodeString("0x" + Buffer.from("MKR").toString("hex").padEnd(64, "0"))).toBe("MKR");
    expect(decodeString("0x")).toBeUndefined();
  });
  it("decodes eip712Domain()", () => {
    const w = (h: string) => h.replace(/^0x/, "").padStart(64, "0");
    const str = (s: string) => w(s.length.toString(16)) + Buffer.from(s).toString("hex").padEnd(64, "0");
    const data =
      "0x" +
      "0f".padEnd(64, "0") +
      w((7 * 32).toString(16)) +
      w((9 * 32).toString(16)) +
      w("2105") +
      w("833589fcd6edb6e08f4c7c32d4f71b54bda02913") +
      w("0") +
      w((11 * 32).toString(16)) +
      str("USD Coin") +
      str("2") +
      w("0");
    const d = decodeEip712Domain(data)!;
    expect(d.name).toBe("USD Coin");
    expect(d.version).toBe("2");
    expect(d.chainId).toBe(8453n);
  });
  it("EIP-55 checksums", () => {
    expect(toChecksumAddress("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913")).toBe("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
    expect(checksumStatus("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913")).toBe("valid");
    expect(checksumStatus("0x833589FCD6eDb6E08f4c7C32D4f71b54bdA02913")).toBe("bad-checksum");
    expect(checksumStatus("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913")).toBe("no-checksum");
  });
  it("formats units", () => {
    expect(formatUnits("10000", 6)).toBe("0.01");
    expect(formatUnits("1000000", 6)).toBe("1");
    expect(formatUnits("1", 18)).toBe("0.000000000000000001");
  });
});

describe("header decoding", () => {
  it("decodes standard base64 and detects base64url", () => {
    const j = { x402Version: 2, a: "ÿþ>>>???" };
    const std = Buffer.from(JSON.stringify(j)).toString("base64");
    const url = Buffer.from(JSON.stringify(j)).toString("base64url");
    expect(std).toMatch(/[+/]/);
    expect(decodeHeaderValue(std)).toMatchObject({ ok: true, encoding: "base64" });
    expect(decodeHeaderValue(url)).toMatchObject({ ok: true, encoding: "base64url" });
    expect(decodeHeaderValue('{"x402Version":2}')).toMatchObject({ ok: false, stage: "encoding" });
    expect(decodeHeaderValue(Buffer.from("nope").toString("base64"))).toMatchObject({ ok: false, stage: "json" });
  });
});

function rep(checks: Partial<Check>[], extra: Partial<Report> = {}): Report {
  const cs = checks.map((c) => ({ category: "schema", title: "", message: "", status: "pass", ...c }) as Check);
  return {
    tool: "x402-doctor",
    toolVersion: "t",
    url: "u",
    method: "GET",
    probedAt: "",
    score: score(cs),
    verdict: "fail",
    settlementBroken: cs.some((c) => c.status === "fail" && c.critical),
    noWorkingOption: false,
    prices: [],
    checks: cs,
    timingMs: 0,
    challenge: { version: 2, source: "header", raw: {}, accepts: [{ index: 0, raw: {} }] },
    ...extra,
  };
}

describe("scan confirmation", () => {
  it("counts only failures that reproduce", () => {
    const a = rep([
      { id: "handshake.status-402", status: "pass" },
      { id: "asset.eip712-domain", status: "fail", critical: true, accept: 0 },
      { id: "handshake.cors-expose", status: "fail" },
    ]);
    const b = rep([
      { id: "handshake.status-402", status: "pass" },
      { id: "asset.eip712-domain", status: "fail", critical: true, accept: 0 },
      { id: "schema.timeout", status: "fail", accept: 0 },
    ]);
    const c = confirm(a, b);
    expect(c.checks.find((x) => x.id === "asset.eip712-domain")!.status).toBe("fail");
    expect(c.checks.find((x) => x.id === "schema.timeout")!.status).toBe("unknown");
    expect(c.settlementBroken).toBe(true);
  });
  it("a second probe that is rate-limited makes the endpoint inconclusive", () => {
    const a = rep([
      { id: "handshake.status-402", status: "pass" },
      { id: "asset.exists", status: "fail", critical: true, accept: 0 },
    ]);
    const b = rep([{ id: "handshake.status-402", status: "unknown" }], { verdict: "unknown" });
    const c = confirm(a, b);
    expect(c.verdict).toBe("unknown");
    expect(c.settlementBroken).toBe(false);
    expect(outcomeOf(c)).toBe("inconclusive");
  });
});

describe("scan selection", () => {
  it("dedupes, skips POST-only and private hosts, caps per host", () => {
    const mk = (resource: string, method?: string) => ({ source: "t", resource, type: "http", x402Version: 2, method, accepts: [] });
    const { targets, stats } = selectTargets(
      [
        mk("https://a.com/1"),
        mk("https://a.com/2"),
        mk("https://a.com/3"),
        mk("https://a.com/1"),
        mk("https://b.com/x", "POST"),
        mk("http://localhost:3000/x"),
        mk("https://c.com/y", "GET"),
      ],
      { perHost: 2 },
    );
    expect(targets.length).toBe(3);
    expect(targets.filter((t) => t.host === "a.com").length).toBe(2);
    expect(stats.nonGet).toBe(1);
  });
});

describe("scan outcomes", () => {
  it("platform 402s are host-disabled, not x402 failures", () => {
    const r = rep(
      [{ id: "handshake.status-402", status: "fail", critical: true, data: { status: 402, platform: "vercel:DEPLOYMENT_DISABLED" } }],
      { challenge: undefined },
    );
    expect(outcomeOf(r)).toBe("host-disabled");
  });
});

describe("package metadata", () => {
  it("VERSION matches package.json (it is embedded in the User-Agent and --version)", async () => {
    const { readFileSync } = await import("node:fs");
    const { VERSION } = await import("../src/http.js");
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
    expect(VERSION).toBe(pkg.version);
  });
});

describe("rpc error classification", () => {
  it("only a contract revert is an on-chain answer; node-side limits are errors", () => {
    expect(isRevert("execution reverted", 3)).toBe(true);
    expect(isRevert("execution reverted: FiatToken: invalid signature", -32000)).toBe(true);
    expect(isRevert("invalid opcode: INVALID", -32000)).toBe(true);
    expect(isRevert("execution aborted (timeout = 5s)", -32000)).toBe(false);
    expect(isRevert("request timed out", -32000)).toBe(false);
    expect(isRevert("gas required exceeds allowance (50000000)", -32000)).toBe(false);
    expect(isRevert("out of gas", -32000)).toBe(false);
  });
});

describe("scan aggregate privacy", () => {
  const ctx = {
    date: "2026-01-01",
    catalog: { fetchedAt: "", sources: {} },
    stats: { uniqueUrls: 1, hosts: 1, methods: {}, nonGet: 0, getHosts: 1 },
    domainAudit: { rows: [], resourcesChecked: 0, resourcesVerified: 0, resourcesWithMismatch: 0 },
    perHost: 1,
  };
  const target = { url: "https://merchant.example/paid", host: "merchant.example", method: "GET", sources: ["t"], catalogVersion: 2 };
  const report = rep(
    [
      { id: "handshake.status-402", status: "pass" },
      // offline-table result recorded before data.network existed: the label must come from the option
      {
        id: "asset.eip712-domain",
        status: "fail",
        critical: true,
        accept: 0,
        data: { got: { name: "USDm", version: "2" }, expected: { name: "MegaUSD", version: "1" } },
      },
    ],
    {
      challenge: {
        version: 2,
        source: "header",
        raw: {},
        accepts: [{ index: 0, caip2: "eip155:84532", network: "eip155:84532", raw: {} }],
      },
      prices: [{ accept: 0, atomic: "10000", usd: 0.0123, network: "eip155:84532" }],
    },
  );
  const agg = aggregate([{ target, report }], ctx);
  it("rows carry probe results only, no networks or prices that fingerprint against the catalog", () => {
    expect(Object.keys(agg.endpoints[0]!).sort()).toEqual(["fails", "host", "outcome", "score", "settlementBroken", "version", "warns"]);
    expect(JSON.stringify(agg.endpoints)).not.toContain("merchant.example");
    expect(JSON.stringify(agg.endpoints)).not.toContain("0.0123");
    expect(agg.endpoints[0]!.host).toMatch(/^h_[0-9a-f]{12}$/);
  });
  it("host ids use a fresh salt per report", () => {
    expect(aggregate([{ target, report }], ctx).endpoints[0]!.host).not.toBe(agg.endpoints[0]!.host);
  });
  it("labels a domain mismatch with the option's network when the check data lacks it", () => {
    expect(agg.domainMismatchPairs[0]!.pair).toBe('Base Sepolia: declared "USDm"/v2, token is "MegaUSD"/v1');
  });
});
