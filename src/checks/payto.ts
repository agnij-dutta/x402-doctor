import type { Check, NormalizedRequirement } from "../types.js";
import type { RpcClient } from "../rpc.js";
import { ADDRESS_REGEX, ZERO_ADDRESS, checksumStatus } from "../evm.js";
import { PERMIT2_ADDRESS, X402_EXACT_PERMIT2_PROXY, X402_UPTO_PERMIT2_PROXY, labelFor, namespaceOf } from "../networks.js";
import { isSolanaPubkey } from "./asset-svm.js";
import { findKnownAsset } from "../knownAssets.js";

const C = "payTo" as const;
const ROLE_CONSTANTS = ["merchant"];

export async function checkPayTo(a: NormalizedRequirement, rpc: RpcClient | undefined): Promise<Check[]> {
  const out: Check[] = [];
  const i = a.index;
  const tag = `accepts[${i}]`;
  const p = a.payTo;
  const ns = namespaceOf(a.caip2);
  if (p === undefined) return out; // reported by schema.required-fields
  if (typeof p === "string" && ROLE_CONSTANTS.includes(p)) {
    out.push({
      id: "payTo.valid",
      category: C,
      status: "pass",
      accept: i,
      title: "payTo is a valid address",
      message: `${tag} payTo is the role constant "${p}".`,
    });
    return out;
  }
  if (ns === "eip155") {
    if (typeof p !== "string" || !ADDRESS_REGEX.test(p)) {
      out.push({
        id: "payTo.valid",
        category: C,
        status: "fail",
        critical: true,
        accept: i,
        title: "payTo is a valid address",
        message: `${tag} payTo ${JSON.stringify(p)} is not a valid EVM address${typeof p === "string" && isSolanaPubkey(p) ? " (it looks like a Solana address on an EVM network)" : ""}.`,
        fix: "Set payTo to the 0x address that should receive funds.",
      });
      return out;
    }
    if (p.toLowerCase() === ZERO_ADDRESS) {
      out.push({
        id: "payTo.valid",
        category: C,
        status: "fail",
        critical: true,
        accept: i,
        title: "payTo is a valid address",
        message: `${tag} payTo is the zero address: USDC rejects transfers to it, and anything that did land would be burned.`,
        fix: "Set payTo to your receiving wallet (an env var that was never filled in?).",
      });
      return out;
    }
    if (typeof a.asset === "string" && p.toLowerCase() === a.asset.toLowerCase()) {
      out.push({
        id: "payTo.valid",
        category: C,
        status: "fail",
        critical: true,
        accept: i,
        title: "payTo is a valid address",
        message: `${tag} payTo equals the asset contract address: payments would be sent to the token contract itself.`,
        fix: "payTo is your wallet, asset is the token. They look swapped or copy-pasted.",
      });
      return out;
    }
    if (
      [PERMIT2_ADDRESS, X402_EXACT_PERMIT2_PROXY, X402_UPTO_PERMIT2_PROXY].some((x) => x.toLowerCase() === p.toLowerCase()) ||
      findKnownAsset(p).length
    ) {
      out.push({
        id: "payTo.valid",
        category: C,
        status: "fail",
        critical: true,
        accept: i,
        title: "payTo is a valid address",
        message: `${tag} payTo ${p} is protocol infrastructure (a token or Permit2 contract), not a merchant wallet.`,
        fix: "Set payTo to your receiving wallet.",
      });
      return out;
    }
    if (checksumStatus(p) === "bad-checksum") {
      out.push({
        id: "payTo.checksum",
        category: C,
        status: "warn",
        accept: i,
        title: "payTo checksum",
        message: `${tag} payTo ${p} fails its EIP-55 checksum; likely a typo, and funds would go to the wrong address.`,
        fix: "Re-copy the address from your wallet.",
      });
    }
    out.push({
      id: "payTo.valid",
      category: C,
      status: "pass",
      accept: i,
      title: "payTo is a valid address",
      message: `${tag} payTo ${p}.`,
    });
    if (rpc && a.caip2 && rpc.hasRpc(a.caip2)) {
      const code = await rpc.getCode(a.caip2, p);
      if (code.kind === "ok" && code.result && code.result !== "0x") {
        const isDelegation = typeof code.result === "string" && code.result.toLowerCase().startsWith("0xef0100");
        out.push({
          id: "payTo.contract",
          category: C,
          status: isDelegation ? "pass" : "warn",
          accept: i,
          title: "payTo is a wallet",
          message: isDelegation
            ? `${tag} payTo is an EIP-7702 delegated EOA.`
            : `${tag} payTo is a contract on ${labelFor(a.caip2)}. Fine for a Safe or splitter that can move tokens; a problem if it's a contract that can't.`,
          fix: isDelegation
            ? undefined
            : "Make sure this contract can transfer the token out (Safe, smart wallet, splitter). If unsure, use an EOA.",
        });
      } else if (code.kind === "ok") {
        out.push({
          id: "payTo.contract",
          category: C,
          status: "pass",
          accept: i,
          title: "payTo is a wallet",
          message: `${tag} payTo is an EOA on ${labelFor(a.caip2)}.`,
        });
      }
    }
    return out;
  }
  if (ns === "solana") {
    if (!isSolanaPubkey(p)) {
      out.push({
        id: "payTo.valid",
        category: C,
        status: "fail",
        critical: true,
        accept: i,
        title: "payTo is a valid address",
        message: `${tag} payTo ${JSON.stringify(p)} is not a base58 Solana public key${typeof p === "string" && ADDRESS_REGEX.test(p) ? " (it's an EVM address on a Solana network)" : ""}.`,
        fix: "Set payTo to your Solana wallet address.",
      });
      return out;
    }
    if (p === "11111111111111111111111111111111") {
      out.push({
        id: "payTo.valid",
        category: C,
        status: "fail",
        critical: true,
        accept: i,
        title: "payTo is a valid address",
        message: `${tag} payTo is the System Program id.`,
        fix: "Set payTo to your wallet.",
      });
      return out;
    }
    if (p === a.asset) {
      out.push({
        id: "payTo.valid",
        category: C,
        status: "fail",
        critical: true,
        accept: i,
        title: "payTo is a valid address",
        message: `${tag} payTo equals the mint address.`,
        fix: "payTo is your wallet, asset is the mint.",
      });
      return out;
    }
    out.push({
      id: "payTo.valid",
      category: C,
      status: "pass",
      accept: i,
      title: "payTo is a valid address",
      message: `${tag} payTo ${p}.`,
    });
    return out;
  }
  if (typeof p !== "string" || p.length === 0) {
    out.push({
      id: "payTo.valid",
      category: C,
      status: "fail",
      critical: true,
      accept: i,
      title: "payTo is a valid address",
      message: `${tag} payTo is not a string.`,
      fix: "Set payTo.",
    });
  }
  return out;
}
