// Verifies that extra.name / extra.version reproduce the EIP-712 domain the signature will be checked
// against. Spec: x402 specs/schemes/exact/scheme_exact_evm.md (EIP-3009 transferWithAuthorization,
// domain {name, version, chainId, verifyingContract}).
import type { Check } from "../types.js";
import type { RpcClient } from "../rpc.js";
import { domainSeparator, type Eip5267Domain } from "../evm.js";
import { labelFor } from "../networks.js";
import { C, rpcUnknown } from "./asset-common.js";

export interface DomainInput {
  /** Index of the payment option in accepts[]. */
  i: number;
  tag: string;
  network: string;
  chainId: number;
  method: string;
  extraName?: string;
  extraVersion?: string;
  /** True when extra.verifyingContract names a contract other than the token. */
  separateDomain: boolean;
  vc?: string;
  /** The contract whose domain we verify: the token, or extra.verifyingContract. */
  domainAddr: string;
  domainWhat: string;
  /** On-chain reads against domainAddr. */
  onDS?: string;
  d5267?: Eip5267Domain;
  onName?: string;
  onVersion?: string;
  /**
   * True when DOMAIN_SEPARATOR() or eip712Domain() failed at the transport level (not a revert).
   * Then name()/version() is only a stand-in: ERC-20 name() can differ from the signing domain.
   */
  authorityErrored?: boolean;
}

/**
 * Compare the declared domain to the chain. Order of authority: DOMAIN_SEPARATOR() (exact, catches
 * chainId/verifyingContract issues too), then eip712Domain() (EIP-5267), then name()/version().
 */
export async function checkEip712Domain(d: DomainInput, rpc: RpcClient): Promise<Check[]> {
  const {
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
    authorityErrored,
  } = d;
  const out: Check[] = [];
  let vcMissing = false;
  if (separateDomain && extraName !== undefined && extraVersion !== undefined) {
    const vcCode = await rpc.getCode(network, domainAddr);
    if (vcCode.kind === "ok" && (!vcCode.result || vcCode.result === "0x")) {
      vcMissing = true;
      out.push({
        id: "asset.eip712-domain",
        category: C,
        status: "warn",
        accept: i,
        title: "EIP-712 domain matches the verifying contract",
        message: `${tag} extra.verifyingContract ${vc} has no contract code on ${labelFor(network)}. Fine only if this scheme's verifier is entirely off-chain.`,
        fix: `Use the verifying contract's address on ${labelFor(network)}.`,
        data: { verifyingContract: vc, network },
      });
    } else if (vcCode.kind !== "ok") {
      vcMissing = true;
      out.push(rpcUnknown("asset.eip712-domain", "EIP-712 domain matches the verifying contract", i, vcCode));
    }
  }
  if (extraName === undefined || extraVersion === undefined || vcMissing) {
    // schema check already reports a missing field; a missing verifying contract is reported above
  } else {
    const computed = domainSeparator(extraName, extraVersion, chainId, domainAddr).toLowerCase();
    const truthName = d5267?.name ?? onName;
    const truthVersion = d5267?.version ?? onVersion;
    let verdict: "match" | "mismatch" | "unverifiable";
    let source: string;
    if (onDS) {
      source = "DOMAIN_SEPARATOR()";
      verdict = computed === onDS ? "match" : "mismatch";
    } else if (d5267) {
      source = "eip712Domain()";
      verdict = d5267.name === extraName && d5267.version === extraVersion ? "match" : "mismatch";
    } else if (onName !== undefined && onVersion !== undefined) {
      source = "name()/version()";
      verdict = onName === extraName && onVersion === extraVersion ? "match" : authorityErrored ? "unverifiable" : "mismatch";
    } else {
      source = "none";
      verdict = "unverifiable";
    }
    if (verdict === "match") {
      out.push({
        id: "asset.eip712-domain",
        category: C,
        status: "pass",
        accept: i,
        title: "EIP-712 domain matches the token",
        message: `${tag} extra {name:"${extraName}", version:"${extraVersion}"} reproduces ${separateDomain ? `${domainWhat}'s` : "the token's"} domain separator (${source}).`,
        data: { source, verifyingContract: separateDomain ? vc : undefined },
      });
    } else if (verdict === "mismatch" && separateDomain) {
      // A separate verifyingContract (e.g. Circle Gateway batched settlement, which signs
      // "GatewayWalletBatched" against the GatewayWallet address) is usually verified off-chain by
      // the scheme's own service, so the contract's on-chain domain is not authoritative.
      out.push({
        id: "asset.eip712-domain",
        category: C,
        status: "unknown",
        accept: i,
        title: "EIP-712 domain matches the verifying contract",
        message: `${tag} extra {name:"${extraName}", version:"${extraVersion}"} differs from ${domainWhat}'s on-chain domain {name:"${truthName}", version:"${truthVersion}"}. This scheme signs for a separate verifier that may check signatures off-chain, so x402-doctor can't confirm it either way.`,
        fix: "Confirm with a testnet payment through the facilitator that settles this option.",
        data: {
          source,
          expected: { name: truthName, version: truthVersion },
          got: { name: extraName, version: extraVersion },
          network,
          verifyingContract: vc,
        },
      });
    } else if (verdict === "mismatch") {
      // diagnose: which on-chain combo works?
      let expectName = truthName;
      let expectVersion = truthVersion;
      if (onDS && truthName !== undefined) {
        const candidates: [string, string][] = [];
        for (const n of new Set([truthName, onName, extraName].filter((x): x is string => x !== undefined)))
          for (const v of new Set([truthVersion, onVersion, extraVersion, "1", "2"].filter((x): x is string => x !== undefined)))
            candidates.push([n, v]);
        const hit = candidates.find(([n, v]) => domainSeparator(n, v, chainId, domainAddr).toLowerCase() === onDS);
        if (hit) [expectName, expectVersion] = hit;
      }
      const nameWrong = expectName !== undefined && expectName !== extraName;
      const verWrong = expectVersion !== undefined && expectVersion !== extraVersion;
      const what = [
        nameWrong ? `extra.name is "${extraName}" but ${separateDomain ? domainWhat : "the token"}'s EIP-712 name is "${expectName}"` : "",
        verWrong
          ? `extra.version is "${extraVersion}" but ${separateDomain ? domainWhat : "the token"}'s EIP-712 version is "${expectVersion}"`
          : "",
      ]
        .filter(Boolean)
        .join("; ");
      out.push({
        id: "asset.eip712-domain",
        category: C,
        status: "fail",
        critical: method === "eip3009",
        accept: i,
        title: "EIP-712 domain matches the token",
        message: `${tag} ${what || `extra {name:"${extraName}", version:"${extraVersion}"} does not reproduce the on-chain domain separator`} on ${labelFor(network)}. Clients sign with your extra, the token verifies with its own domain, so every payment signature fails (invalid_exact_evm_payload_signature).`,
        fix:
          expectName !== undefined && expectVersion !== undefined
            ? `Set extra: { name: "${expectName}", version: "${expectVersion}" }.${separateDomain ? "" : ` Note testnet and mainnet USDC differ: Base Sepolia is "USDC", Base mainnet is "USD Coin".`}`
            : "Read the token's eip712Domain()/name()/version() and copy them exactly into extra.",
        data: {
          source,
          expected: { name: expectName, version: expectVersion },
          got: { name: extraName, version: extraVersion },
          network,
          verifyingContract: separateDomain ? vc : undefined,
        },
      });
    } else {
      out.push({
        id: "asset.eip712-domain",
        category: C,
        status: "unknown",
        accept: i,
        title: "EIP-712 domain matches the token",
        message: authorityErrored
          ? `${tag} RPC error reading DOMAIN_SEPARATOR()/eip712Domain(), and name()/version() (${JSON.stringify(onName)}/${JSON.stringify(onVersion)}) differ from extra {name:"${extraName}", version:"${extraVersion}"}. ERC-20 name() isn't always the EIP-712 name, so this can't be confirmed without the domain separator.`
          : `${tag} ${separateDomain ? domainWhat : "token"} exposes no DOMAIN_SEPARATOR(), eip712Domain() or version(); couldn't verify extra {name:"${extraName}", version:"${extraVersion}"}.`,
        fix: authorityErrored
          ? "Retry, or pass --rpc <caip2>=<url> with a working RPC."
          : "Verify by signing a test authorization against the facilitator's /verify on testnet.",
      });
    }
  }
  return out;
}
