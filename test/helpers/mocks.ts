import http from "node:http";
import type { AddressInfo } from "node:net";
import { domainSeparator, SELECTORS } from "../../src/evm.js";

export const BASE_SEPOLIA = "eip155:84532";
export const USDC_BASE_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
export const NO_3009_TOKEN = "0x1111111111111111111111111111111111111111";
export const PAY_TO = "0x209693Bc6afc0C5328bA36FaF03C514EF312287C";
export const CONTRACT_PAY_TO = "0x2222222222222222222222222222222222222222";
export const USDC_SOL_DEVNET = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
export const SOL_DEVNET = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
/** Stand-in for Circle's GatewayWallet: a separate EIP-712 verifying contract. */
export const GATEWAY_WALLET = "0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE";

// ---------- ABI encoding helpers for the mock RPC ----------
const pad = (h: string) => h.replace(/^0x/, "").padStart(64, "0");
export function abiString(s: string): string {
  const hex = Buffer.from(s, "utf8").toString("hex");
  const padded = hex.padEnd(Math.ceil(hex.length / 64) * 64 || 64, "0");
  return "0x" + pad("20") + pad(s.length.toString(16)) + padded;
}
export const abiUint = (n: number | bigint) => "0x" + pad(BigInt(n).toString(16));

interface Token {
  name: string;
  version?: string;
  symbol: string;
  decimals: number;
  eip3009: boolean;
  domainSeparator?: boolean;
}

export interface MockRpcState {
  /** address(lowercase) -> token, per chain id */
  tokens: Record<string, Token>;
  contracts: Set<string>;
  calls: number;
  failAll?: boolean;
  /** eth_call selectors the node gives up on, answering like geth's RPC-side eth_call timeout. */
  abortSelectors?: Set<string>;
}

export function defaultRpcState(): MockRpcState {
  return {
    tokens: {
      [USDC_BASE_SEPOLIA.toLowerCase()]: { name: "USDC", version: "2", symbol: "USDC", decimals: 6, eip3009: true, domainSeparator: true },
      [NO_3009_TOKEN.toLowerCase()]: {
        name: "Plain Token",
        version: "1",
        symbol: "PLN",
        decimals: 18,
        eip3009: false,
        domainSeparator: false,
      },
      [GATEWAY_WALLET.toLowerCase()]: {
        name: "GatewayWallet",
        version: "1",
        symbol: "",
        decimals: 0,
        eip3009: false,
        domainSeparator: true,
      },
    },
    contracts: new Set([CONTRACT_PAY_TO.toLowerCase()]),
    calls: 0,
  };
}

export async function startMockRpc(state: MockRpcState, chainId = 84532) {
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      state.calls++;
      const { id, method, params } = JSON.parse(body);
      const reply = (o: object) => {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ jsonrpc: "2.0", id, ...o }));
      };
      if (state.failAll) {
        res.statusCode = 503;
        return res.end("down");
      }
      if (method === "eth_chainId") return reply({ result: abiUint(chainId) });
      if (method === "eth_getCode") {
        const a = String(params[0]).toLowerCase();
        return reply({ result: state.tokens[a] || state.contracts.has(a) ? "0x6080604052" : "0x" });
      }
      if (method === "eth_call") {
        const to = String(params[0].to).toLowerCase();
        const data = String(params[0].data);
        const t = state.tokens[to];
        const revert = () => reply({ error: { code: 3, message: "execution reverted" } });
        if (!t) return reply({ result: "0x" });
        const sel = data.slice(0, 10);
        if (state.abortSelectors?.has(sel)) return reply({ error: { code: -32000, message: "execution aborted (timeout = 5s)" } });
        if (sel === SELECTORS.name) return reply({ result: abiString(t.name) });
        if (sel === SELECTORS.version) return t.version ? reply({ result: abiString(t.version) }) : revert();
        if (sel === SELECTORS.symbol) return reply({ result: abiString(t.symbol) });
        if (sel === SELECTORS.decimals) return reply({ result: abiUint(t.decimals) });
        if (sel === SELECTORS.DOMAIN_SEPARATOR)
          return t.domainSeparator ? reply({ result: domainSeparator(t.name, t.version ?? "1", chainId, to) }) : revert();
        if (sel === SELECTORS.eip712Domain) return revert();
        if (sel === SELECTORS.authorizationState) return t.eip3009 ? reply({ result: abiUint(0) }) : revert();
        return revert();
      }
      if (method === "getAccountInfo") {
        const key = params[0];
        if (key === USDC_SOL_DEVNET)
          return reply({
            result: {
              context: { slot: 1 },
              value: { owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", data: { parsed: { type: "mint", info: { decimals: 6 } } } },
            },
          });
        return reply({ result: { context: { slot: 1 }, value: null } });
      }
      reply({ error: { code: -32601, message: "method not found" } });
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { url, close: () => new Promise<void>((r) => server.close(() => r())) };
}

// ---------- mock x402 resource server ----------

export interface RouteSpec {
  status?: number;
  /** v2 header object (base64-encoded by the server unless headerRaw is set) */
  header?: Record<string, unknown>;
  headerRaw?: string;
  headerEncoding?: "base64" | "base64url";
  body?: unknown;
  /** Raw body text (sent as-is, overrides body). */
  bodyRaw?: string;
  /** Extra response headers. */
  headers?: Record<string, string>;
  cors?: { allowOrigin?: string; expose?: string; allowHeaders?: string } | false;
  headStatus?: number;
  /** Status for the OPTIONS preflight (default 204). */
  optionsStatus?: number;
  delayMs?: number;
}

export async function startMockServer(routes: Record<string, RouteSpec>) {
  const hits: { method: string; path: string; headers: http.IncomingHttpHeaders }[] = [];
  const server = http.createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0]!;
    hits.push({ method: req.method ?? "", path, headers: req.headers });
    const spec = routes[path];
    if (!spec) {
      res.statusCode = 404;
      return res.end("not found");
    }
    const send = () => {
      if (spec.cors) {
        if (spec.cors.allowOrigin) res.setHeader("access-control-allow-origin", spec.cors.allowOrigin);
        if (spec.cors.expose) res.setHeader("access-control-expose-headers", spec.cors.expose);
      }
      if (req.method === "OPTIONS") {
        if (spec.cors && spec.cors.allowHeaders) res.setHeader("access-control-allow-headers", spec.cors.allowHeaders);
        res.statusCode = spec.optionsStatus ?? 204;
        return res.end();
      }
      if (req.method === "HEAD" && spec.headStatus) {
        res.statusCode = spec.headStatus;
        return res.end();
      }
      res.statusCode = spec.status ?? 402;
      if (spec.headerRaw !== undefined) res.setHeader("payment-required", spec.headerRaw);
      else if (spec.header) {
        const json = JSON.stringify(spec.header);
        res.setHeader("payment-required", Buffer.from(json).toString(spec.headerEncoding === "base64url" ? "base64url" : "base64"));
      }
      for (const [k, v] of Object.entries(spec.headers ?? {})) res.setHeader(k, v);
      if (spec.bodyRaw !== undefined) {
        res.setHeader("content-type", "text/plain; charset=utf-8");
        return res.end(spec.bodyRaw);
      }
      res.setHeader("content-type", "application/json");
      res.end(spec.body === undefined ? "{}" : JSON.stringify(spec.body));
    };
    if (spec.delayMs) setTimeout(send, spec.delayMs);
    else send();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, hits, close: () => new Promise<void>((r) => server.close(() => r())) };
}

// ---------- fixtures ----------

export function v2Challenge(url: string, over: Record<string, unknown> = {}, extraOver?: Record<string, unknown>) {
  return {
    x402Version: 2,
    error: "PAYMENT-SIGNATURE header is required",
    resource: { url, description: "test", mimeType: "application/json" },
    accepts: [
      {
        scheme: "exact",
        network: BASE_SEPOLIA,
        amount: "10000",
        asset: USDC_BASE_SEPOLIA,
        payTo: PAY_TO,
        maxTimeoutSeconds: 60,
        extra: { name: "USDC", version: "2", ...(extraOver ?? {}) },
        ...over,
      },
    ],
  };
}

export function v1Challenge(url: string, over: Record<string, unknown> = {}) {
  return {
    x402Version: 1,
    error: "X-PAYMENT header is required",
    accepts: [
      {
        scheme: "exact",
        network: "base-sepolia",
        maxAmountRequired: "10000",
        resource: url,
        description: "test",
        mimeType: "application/json",
        payTo: PAY_TO,
        maxTimeoutSeconds: 60,
        asset: USDC_BASE_SEPOLIA,
        extra: { name: "USDC", version: "2" },
        ...over,
      },
    ],
  };
}

export const GOOD_CORS = {
  allowOrigin: "*",
  expose: "PAYMENT-REQUIRED, PAYMENT-RESPONSE",
  allowHeaders: "PAYMENT-SIGNATURE, Content-Type",
};
export const GOOD_CORS_V1 = { allowOrigin: "*", expose: "X-PAYMENT-RESPONSE", allowHeaders: "X-PAYMENT, Content-Type" };
