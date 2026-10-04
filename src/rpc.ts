import { rpcsFor } from "./networks.js";

/**
 * Result of one JSON-RPC call. "reverted" is a real on-chain answer (the contract said no);
 * "error" means we couldn't get an answer (transport, rate limit, malformed reply) and must be
 * reported as inconclusive, never as a failure.
 */
export type RpcOutcome<T = unknown> =
  { kind: "ok"; result: T; rpc: string } | { kind: "reverted"; message: string; rpc: string } | { kind: "error"; message: string };

/** The subset of Solana getAccountInfo (jsonParsed) that x402-doctor reads. */
export interface SolanaAccountInfo {
  value: {
    owner: string;
    /** jsonParsed SPL accounts carry { parsed: { type, info } }; other programs return raw data. */
    data?: unknown;
  } | null;
}

/**
 * True only when the node says the contract itself reverted. Node-side limits are not answers from
 * the contract: geth reports its eth_call timeout as "execution aborted (timeout = 5s)" and its gas
 * cap as "out of gas" / "gas required exceeds allowance", and those must stay inconclusive.
 */
export function isRevert(message: string, code?: number): boolean {
  if (/abort|time(d)?\s?out|deadline|gas required exceeds|out of gas|gas cap/i.test(message)) return false;
  return code === 3 || /revert|invalid opcode/i.test(message);
}

function asHex(o: RpcOutcome): RpcOutcome<string> {
  if (o.kind !== "ok") return o;
  return typeof o.result === "string" ? { ...o, result: o.result } : { kind: "error", message: `${o.rpc}: expected a hex string result` };
}

function asSolanaAccount(o: RpcOutcome): RpcOutcome<SolanaAccountInfo> {
  if (o.kind !== "ok") return o;
  const r = o.result as { value?: unknown } | null;
  if (
    r &&
    typeof r === "object" &&
    "value" in r &&
    (r.value === null || (typeof r.value === "object" && typeof (r.value as { owner?: unknown }).owner === "string"))
  ) {
    return { ...o, result: r as SolanaAccountInfo };
  }
  return { kind: "error", message: `${o.rpc}: malformed getAccountInfo result` };
}

export interface RpcClientOpts {
  overrides?: Record<string, string | string[]>;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  userAgent?: string;
}

/**
 * Minimal keyless JSON-RPC client with per-network fallback and an in-memory cache.
 * Cached by (network, method, params). Transport errors are never cached.
 */
export class RpcClient {
  private cache = new Map<string, Promise<RpcOutcome>>();
  constructor(private opts: RpcClientOpts = {}) {}

  /** True when at least one RPC (built-in or override) is known for this CAIP-2 network. */
  hasRpc(network: string): boolean {
    return rpcsFor(network, this.opts.overrides).length > 0;
  }

  /** Raw JSON-RPC call with fallback across the network's RPCs. Errors are not cached; answers are. */
  call(network: string, method: string, params: unknown[]): Promise<RpcOutcome> {
    const key = `${network}|${method}|${JSON.stringify(params)}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const p = this.doCall(network, method, params).then((r) => {
      if (r.kind === "error") this.cache.delete(key);
      return r;
    });
    this.cache.set(key, p);
    return p;
  }

  private async doCall(network: string, method: string, params: unknown[]): Promise<RpcOutcome> {
    const urls = rpcsFor(network, this.opts.overrides);
    if (urls.length === 0) return { kind: "error", message: `no RPC configured for ${network}` };
    const f = this.opts.fetchImpl ?? fetch;
    let lastErr = "";
    for (const url of urls) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const res = await f(url, {
            method: "POST",
            headers: { "content-type": "application/json", "user-agent": this.opts.userAgent ?? "x402-doctor" },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
            signal: AbortSignal.timeout(this.opts.timeoutMs ?? 10000),
          });
          if (res.status === 429 || res.status >= 500) {
            lastErr = `${url} HTTP ${res.status}`;
            await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
            continue;
          }
          const j = (await res.json()) as { result?: unknown; error?: { code?: number; message?: string; data?: unknown } };
          if (j.error) {
            const msg = j.error.message ?? "rpc error";
            if (isRevert(msg, j.error.code)) {
              return { kind: "reverted", message: msg, rpc: url };
            }
            if (/rate|limit|too many/i.test(msg)) {
              lastErr = `${url}: ${msg}`;
              await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
              continue;
            }
            lastErr = `${url}: ${msg}`;
            break;
          }
          return { kind: "ok", result: j.result, rpc: url };
        } catch (e) {
          lastErr = `${url}: ${(e as Error).message}`;
        }
      }
    }
    return { kind: "error", message: lastErr || "rpc failed" };
  }

  /** eth_call at latest; result is the raw hex return data. */
  async ethCall(network: string, to: string, data: string): Promise<RpcOutcome<string>> {
    return asHex(await this.call(network, "eth_call", [{ to, data }, "latest"]));
  }

  /** eth_getCode at latest; "0x" means no contract. */
  async getCode(network: string, address: string): Promise<RpcOutcome<string>> {
    return asHex(await this.call(network, "eth_getCode", [address, "latest"]));
  }

  /** Solana getAccountInfo (jsonParsed, confirmed); value is null when the account doesn't exist. */
  async solanaAccount(network: string, pubkey: string): Promise<RpcOutcome<SolanaAccountInfo>> {
    return asSolanaAccount(await this.call(network, "getAccountInfo", [pubkey, { encoding: "jsonParsed", commitment: "confirmed" }]));
  }
}
