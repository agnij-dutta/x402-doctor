// On-chain asset checks. Every RPC error becomes "unknown", never "fail".
import type { Check, NormalizedRequirement } from "../types.js";
import type { RpcClient } from "../rpc.js";
import {
  ADDRESS_REGEX,
  SELECTORS,
  checksumStatus,
  decodeEip712Domain,
  decodeString,
  decodeUint,
  encodeAuthorizationState,
} from "../evm.js";
import { PERMIT2_ADDRESS, X402_EXACT_PERMIT2_PROXY, X402_UPTO_PERMIT2_PROXY, chainIdOf, labelFor, namespaceOf } from "../networks.js";
import { findKnownAsset } from "../knownAssets.js";
import { C, rpcUnknown, type AssetResult } from "./asset-common.js";
import { checkSvmAsset } from "./asset-svm.js";
import { checkEip712Domain } from "./eip712-domain.js";
import { makePrice } from "./price.js";

export type { AssetResult } from "./asset-common.js";
export { formatUnits, makePrice } from "./price.js";
export { isSolanaPubkey } from "./asset-svm.js";

/** Run the on-chain checks for one payment option, dispatching on the CAIP-2 namespace. */
export async function checkAsset(a: NormalizedRequirement, rpc: RpcClient | undefined): Promise<AssetResult> {
  const ns = namespaceOf(a.caip2);
  if (ns === "eip155") return checkEvmAsset(a, rpc);
  if (ns === "solana") return checkSvmAsset(a, rpc);
  return {
    checks: [
      {
        id: "asset.supported",
        category: C,
        status: "skip",
        accept: a.index,
        title: "Asset sanity",
        message: `On-chain checks for ${a.network ?? "this network"} aren't implemented yet.`,
      },
    ],
    price: makePrice(a),
  };
}

/** EVM: contract exists, decimals/price, EIP-712 domain, EIP-3009 support, Permit2 plumbing. */
async function checkEvmAsset(a: NormalizedRequirement, rpc: RpcClient | undefined): Promise<AssetResult> {
  const i = a.index;
  const tag = `accepts[${i}]`;
  const out: Check[] = [];
  const network = a.caip2!;
  const chainId = chainIdOf(network)!;
  const asset = a.asset;
  if (typeof asset !== "string" || !ADDRESS_REGEX.test(asset)) {
    out.push({
      id: "asset.address",
      category: C,
      status: "fail",
      critical: true,
      accept: i,
      title: "Asset is a token address",
      message: `${tag} asset ${JSON.stringify(asset)} is not a 0x-prefixed 20-byte address.`,
      fix: "Set asset to the token contract address (Base USDC: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913).",
    });
    return { checks: out, price: makePrice(a) };
  }
  if (checksumStatus(asset) === "bad-checksum") {
    out.push({
      id: "asset.checksum",
      category: C,
      status: "warn",
      accept: i,
      title: "Asset address checksum",
      message: `${tag} asset ${asset} has an invalid EIP-55 checksum (typo?).`,
      fix: "Copy the address from a block explorer.",
    });
  }

  const known = findKnownAsset(asset);
  const knownHere = known.find((k) => k.network === network);
  const method = (a.extra?.assetTransferMethod as string | undefined) ?? "eip3009";
  const extraName = typeof a.extra?.name === "string" ? a.extra.name : undefined;
  const extraVersion = typeof a.extra?.version === "string" ? a.extra.version : undefined;
  const needsDomain = (a.scheme === "exact" && method === "eip3009") || (method === "permit2" && extraName !== undefined);
  // Some schemes (e.g. Circle Gateway batched settlement) sign against a separate contract named in
  // extra.verifyingContract, not the token. Then the domain to verify is that contract's.
  const vc = typeof a.extra?.verifyingContract === "string" ? a.extra.verifyingContract : undefined;
  const separateDomain = vc !== undefined && ADDRESS_REGEX.test(vc) && vc.toLowerCase() !== asset.toLowerCase();
  const domainAddr = separateDomain ? vc : asset;
  const domainWhat = separateDomain ? `verifyingContract ${vc}` : "the token";

  if (!rpc || !rpc.hasRpc(network)) {
    // offline fallback: compare against the verified table
    if (knownHere && needsDomain && extraName !== undefined && !separateDomain) {
      const ok = knownHere.name === extraName && knownHere.version === extraVersion;
      out.push({
        id: "asset.eip712-domain",
        category: C,
        status: ok ? "pass" : "fail",
        critical: !ok && method === "eip3009",
        accept: i,
        title: "EIP-712 domain matches the token",
        message: ok
          ? `${tag} extra {name:"${extraName}", version:"${extraVersion}"} matches ${knownHere.symbol} on ${labelFor(network)} (known table; no RPC).`
          : `${tag} extra {name:"${extraName}", version:"${extraVersion}"} but ${knownHere.symbol} on ${labelFor(network)} signs with {name:"${knownHere.name}", version:"${knownHere.version}"}. Every payment signature will fail to verify.`,
        fix: ok ? undefined : `Set extra.name = "${knownHere.name}" and extra.version = "${knownHere.version}".`,
        data: {
          expected: { name: knownHere.name, version: knownHere.version },
          got: { name: extraName, version: extraVersion },
          source: "table",
          network,
        },
      });
    } else {
      out.push({
        id: "asset.onchain",
        category: C,
        status: "skip",
        accept: i,
        title: "On-chain asset checks",
        message: `No RPC for ${labelFor(network)}; skipped.`,
      });
    }
    return { checks: out, price: makePrice(a, knownHere?.decimals, knownHere?.symbol) };
  }

  // existence
  const code = await rpc.getCode(network, asset);
  if (code.kind !== "ok") {
    out.push(rpcUnknown("asset.exists", "Asset contract exists on the network", i, code));
    return { checks: out, price: makePrice(a, knownHere?.decimals, knownHere?.symbol) };
  }
  if (!code.result || code.result === "0x") {
    const elsewhere = known.filter((k) => k.network !== network);
    out.push({
      id: "asset.exists",
      category: C,
      status: "fail",
      critical: true,
      accept: i,
      title: "Asset contract exists on the network",
      message: `${tag} asset ${asset} has no contract code on ${labelFor(network)} (${network}).${elsewhere.length ? ` That address is ${elsewhere[0]!.symbol} on ${elsewhere.map((k) => labelFor(k.network)).join(", ")}.` : ""}`,
      fix: elsewhere.length
        ? `Either change network to ${elsewhere[0]!.network} or use the ${labelFor(network)} token address.`
        : `Use the token's address on ${labelFor(network)}.`,
      data: { elsewhere: elsewhere.map((k) => k.network) },
    });
    return { checks: out, price: makePrice(a) };
  }
  out.push({
    id: "asset.exists",
    category: C,
    status: "pass",
    accept: i,
    title: "Asset contract exists on the network",
    message: `${tag} asset has code on ${labelFor(network)}.`,
  });

  // token metadata
  const [nameR, verR, symR, decR, dsR, d5267R] = await Promise.all([
    rpc.ethCall(network, domainAddr, SELECTORS.name),
    rpc.ethCall(network, domainAddr, SELECTORS.version),
    rpc.ethCall(network, asset, SELECTORS.symbol),
    rpc.ethCall(network, asset, SELECTORS.decimals),
    rpc.ethCall(network, domainAddr, SELECTORS.DOMAIN_SEPARATOR),
    rpc.ethCall(network, domainAddr, SELECTORS.eip712Domain),
  ]);
  const onName = nameR.kind === "ok" ? decodeString(nameR.result) : undefined;
  const onVersion = verR.kind === "ok" ? decodeString(verR.result) : undefined;
  const onSymbol = symR.kind === "ok" ? decodeString(symR.result) : undefined;
  const decBig = decR.kind === "ok" ? decodeUint(decR.result) : undefined;
  const decimals = decBig !== undefined && decBig <= 77n ? Number(decBig) : undefined;
  const onDS = dsR.kind === "ok" && typeof dsR.result === "string" && dsR.result.length === 66 ? dsR.result.toLowerCase() : undefined;
  const d5267 = d5267R.kind === "ok" ? decodeEip712Domain(d5267R.result) : undefined;

  if (decimals === undefined) {
    if (decR.kind === "error") out.push(rpcUnknown("asset.decimals", "Token decimals", i, decR));
    else
      out.push({
        id: "asset.decimals",
        category: C,
        status: "warn",
        accept: i,
        title: "Token decimals",
        message: `${tag} asset doesn't answer decimals(); is it an ERC-20?`,
        fix: "Check the asset address.",
      });
  }
  const price = makePrice(a, decimals ?? knownHere?.decimals, onSymbol ?? knownHere?.symbol);
  if (price?.human) {
    out.push({
      id: "asset.price",
      category: C,
      status: "pass",
      accept: i,
      title: "Human price",
      message: `${tag} costs ${price.human} (${String(a.amount)} atomic, ${decimals} decimals${onSymbol ? `, ${onSymbol}` : ""}).`,
      data: { usd: price.usd },
    });
    if (price.usd !== undefined && price.usd >= 100) {
      out.push({
        id: "asset.price-sanity",
        category: C,
        status: "warn",
        accept: i,
        title: "Price looks intended",
        message: `${tag} asks for ${price.human} per request. If you meant cents, the amount is probably missing the ${decimals}-decimal scaling the other way.`,
        fix: `Atomic units: $0.01 = ${10n ** BigInt(Math.max(0, (decimals ?? 6) - 2))} for a ${decimals}-decimal token.`,
      });
    }
    if (decimals === 18 && typeof a.amount === "string" && a.amount.length <= 6) {
      out.push({
        id: "asset.price-sanity",
        category: C,
        status: "warn",
        accept: i,
        title: "Price looks intended",
        message: `${tag} amount ${a.amount} on an 18-decimal token is ${price.human}: almost certainly a USDC-style 6-decimal amount applied to an 18-decimal token.`,
        fix: `Scale by 10^18: $0.01 = 10000000000000000.`,
      });
    }
  }

  // EIP-712 domain
  if (needsDomain) {
    out.push(
      ...(await checkEip712Domain(
        {
          i,
          tag,
          network,
          chainId,
          method,
          extraName,
          extraVersion,
          separateDomain,
          vc,
          domainAddr,
          domainWhat,
          onDS,
          d5267,
          onName,
          onVersion,
          authorityErrored: dsR.kind === "error" || d5267R.kind === "error",
        },
        rpc,
      )),
    );
  }

  // EIP-3009 support
  if (a.scheme === "exact" && method === "eip3009") {
    const st = await rpc.ethCall(network, asset, encodeAuthorizationState());
    if (st.kind === "reverted" || (st.kind === "ok" && (st.result === "0x" || !st.result))) {
      out.push({
        id: "asset.eip3009",
        category: C,
        status: "fail",
        critical: true,
        accept: i,
        title: "Token supports EIP-3009",
        message: `${tag} uses the default eip3009 transfer, but ${onSymbol ?? asset} doesn't implement transferWithAuthorization (authorizationState() reverts).`,
        fix: 'Set extra.assetTransferMethod = "permit2" (any ERC-20 works via Permit2), or use USDC/EURC.',
      });
    } else if (st.kind === "error") {
      out.push(rpcUnknown("asset.eip3009", "Token supports EIP-3009", i, st));
    } else {
      out.push({
        id: "asset.eip3009",
        category: C,
        status: "pass",
        accept: i,
        title: "Token supports EIP-3009",
        message: `${tag} token implements EIP-3009.`,
      });
    }
  }

  // permit2 plumbing
  if (method === "permit2") {
    const proxy = a.scheme === "upto" ? X402_UPTO_PERMIT2_PROXY : X402_EXACT_PERMIT2_PROXY;
    const declared = Object.entries(a.extra ?? {}).find(([k, v]) => /spender|proxy/i.test(k) && typeof v === "string");
    if (declared && (declared[1] as string).toLowerCase() !== proxy.toLowerCase()) {
      out.push({
        id: "asset.permit2-proxy",
        category: C,
        status: "fail",
        critical: true,
        accept: i,
        title: "Permit2 references the x402 proxy",
        message: `${tag} extra.${declared[0]} is ${String(declared[1])}, but the Permit2 spender must be the canonical x402 proxy ${proxy}.`,
        fix: `Remove extra.${declared[0]} or set it to ${proxy}.`,
      });
    }
    const [p2, px] = await Promise.all([rpc.getCode(network, PERMIT2_ADDRESS), rpc.getCode(network, proxy)]);
    for (const [label, r, addr] of [
      ["Permit2", p2, PERMIT2_ADDRESS],
      ["x402 Permit2 proxy", px, proxy],
    ] as const) {
      if (r.kind !== "ok") out.push(rpcUnknown("asset.permit2-deployed", `${label} deployed`, i, r));
      else if (!r.result || r.result === "0x")
        out.push({
          id: "asset.permit2-deployed",
          category: C,
          status: "fail",
          critical: true,
          accept: i,
          title: `${label} deployed`,
          message: `${tag} uses permit2 but ${label} (${addr}) is not deployed on ${labelFor(network)}.`,
          fix: "Use eip3009 with a token that supports it on this chain, or a chain where the x402 proxy is deployed.",
        });
      else
        out.push({
          id: "asset.permit2-deployed",
          category: C,
          status: "pass",
          accept: i,
          title: `${label} deployed`,
          message: `${label} is deployed on ${labelFor(network)}.`,
        });
    }
  }

  return { checks: out, price };
}
