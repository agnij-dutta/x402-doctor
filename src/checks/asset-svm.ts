import { base58 } from "@scure/base";
import type { Check, NormalizedRequirement } from "../types.js";
import type { RpcClient } from "../rpc.js";
import { SPL_TOKEN_2022_PROGRAM, SPL_TOKEN_PROGRAM, USD_STABLECOINS, labelFor } from "../networks.js";
import { C, rpcUnknown, type AssetResult } from "./asset-common.js";
import { makePrice } from "./price.js";

/** Pull the SPL account type and decimals out of jsonParsed account data, if present. */
function parsedSplAccount(data: unknown): { type?: string; decimals?: number } | undefined {
  if (!data || typeof data !== "object" || !("parsed" in data)) return undefined;
  const parsed = (data as { parsed?: { type?: unknown; info?: { decimals?: unknown } } }).parsed;
  if (!parsed || typeof parsed !== "object") return undefined;
  return {
    type: typeof parsed.type === "string" ? parsed.type : undefined,
    decimals: typeof parsed.info?.decimals === "number" ? parsed.info.decimals : undefined,
  };
}

/** True for a base58 string that decodes to a 32-byte Solana public key. */
export function isSolanaPubkey(s: unknown): s is string {
  if (typeof s !== "string" || s.length < 32 || s.length > 44) return false;
  try {
    return base58.decode(s).length === 32;
  } catch {
    return false;
  }
}

/** Solana: the mint exists, is owned by SPL Token / Token-2022, and is a mint (not a token account). */
export async function checkSvmAsset(a: NormalizedRequirement, rpc: RpcClient | undefined): Promise<AssetResult> {
  const i = a.index;
  const tag = `accepts[${i}]`;
  const out: Check[] = [];
  const network = a.caip2!;
  if (!isSolanaPubkey(a.asset)) {
    out.push({
      id: "asset.address",
      category: C,
      status: "fail",
      critical: true,
      accept: i,
      title: "Asset is a mint address",
      message: `${tag} asset ${JSON.stringify(a.asset)} is not a base58 Solana public key.`,
      fix: "Use the SPL mint, e.g. USDC EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v.",
    });
    return { checks: out, price: makePrice(a) };
  }
  if (a.extra && a.extra.feePayer !== undefined && !isSolanaPubkey(a.extra.feePayer)) {
    out.push({
      id: "asset.svm-feepayer",
      category: C,
      status: "fail",
      critical: true,
      accept: i,
      title: "feePayer is a valid pubkey",
      message: `${tag} extra.feePayer ${JSON.stringify(a.extra.feePayer)} is not a valid Solana public key.`,
      fix: "Copy feePayer from your facilitator's /supported.",
    });
  }
  if (!rpc || !rpc.hasRpc(network)) {
    out.push({
      id: "asset.onchain",
      category: C,
      status: "skip",
      accept: i,
      title: "On-chain asset checks",
      message: `No RPC for ${labelFor(network)}; skipped.`,
    });
    return { checks: out, price: makePrice(a, a.asset === "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" ? 6 : undefined, "USDC") };
  }
  const acc = await rpc.solanaAccount(network, a.asset);
  if (acc.kind !== "ok") {
    out.push(rpcUnknown("asset.exists", "Mint exists on the network", i, acc));
    return { checks: out, price: makePrice(a) };
  }
  const value = acc.result.value;
  if (!value) {
    const otherNet =
      a.asset === "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
        ? "Solana mainnet"
        : a.asset === "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
          ? "Solana devnet"
          : undefined;
    out.push({
      id: "asset.exists",
      category: C,
      status: "fail",
      critical: true,
      accept: i,
      title: "Mint exists on the network",
      message: `${tag} mint ${a.asset} doesn't exist on ${labelFor(network)}.${otherNet ? ` It is the USDC mint on ${otherNet}.` : ""}`,
      fix: otherNet
        ? `Network and mint disagree: use the ${labelFor(network)} USDC mint or switch network.`
        : "Use a mint that exists on this cluster.",
    });
    return { checks: out, price: makePrice(a) };
  }
  const owner = value.owner;
  if (owner !== SPL_TOKEN_PROGRAM && owner !== SPL_TOKEN_2022_PROGRAM) {
    out.push({
      id: "asset.exists",
      category: C,
      status: "fail",
      critical: true,
      accept: i,
      title: "Mint exists on the network",
      message: `${tag} ${a.asset} exists but is owned by ${owner}, not the SPL Token program: it isn't a mint.`,
      fix: "asset must be the token mint address, not a wallet or token account.",
    });
    return { checks: out, price: makePrice(a) };
  }
  const parsed = parsedSplAccount(value.data);
  if (parsed?.type && parsed.type !== "mint") {
    out.push({
      id: "asset.exists",
      category: C,
      status: "fail",
      critical: true,
      accept: i,
      title: "Mint exists on the network",
      message: `${tag} ${a.asset} is an SPL ${parsed.type}, not a mint (did you paste your token account?).`,
      fix: "Use the mint address.",
    });
    return { checks: out, price: makePrice(a) };
  }
  const decimals = parsed?.decimals;
  out.push({
    id: "asset.exists",
    category: C,
    status: "pass",
    accept: i,
    title: "Mint exists on the network",
    message: `${tag} mint exists on ${labelFor(network)}${owner === SPL_TOKEN_2022_PROGRAM ? " (Token-2022)" : ""}.`,
  });
  const sym = USD_STABLECOINS[a.asset];
  const price = makePrice(a, decimals, sym);
  if (price?.human)
    out.push({
      id: "asset.price",
      category: C,
      status: "pass",
      accept: i,
      title: "Human price",
      message: `${tag} costs ${price.human} (${String(a.amount)} atomic, ${decimals ?? "?"} decimals).`,
      data: { usd: price.usd },
    });
  return { checks: out, price };
}
