import type { Check, PriceInfo } from "../types.js";
import type { RpcOutcome } from "../rpc.js";

export const C = "asset" as const;

/** Result of the on-chain asset checks for one payment option. */
export interface AssetResult {
  checks: Check[];
  price?: PriceInfo;
}

/** An RPC failure is "unknown", never a failure: a flaky public RPC must not mark an endpoint broken. */
export const rpcUnknown = (id: string, title: string, i: number, o: RpcOutcome): Check => ({
  id,
  category: C,
  status: "unknown",
  accept: i,
  title,
  message: `RPC error: ${o.kind === "error" ? o.message : "unexpected"}`,
  fix: "Retry, or pass --rpc <caip2>=<url> with a working RPC.",
});
