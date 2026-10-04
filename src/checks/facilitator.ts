import type { Check, NormalizedRequirement } from "../types.js";
import { labelFor } from "../networks.js";

const C = "facilitator" as const;

interface SupportedKind {
  x402Version: number;
  scheme: string;
  network: string;
  extra?: Record<string, unknown>;
}
export interface Supported {
  kinds: SupportedKind[];
  signers?: Record<string, string[]>;
}

const cache = new Map<string, Promise<Supported | { error: string }>>();

export function fetchSupported(
  base: string,
  fetchImpl: typeof fetch,
  ua: string,
  timeoutMs = 10000,
): Promise<Supported | { error: string }> {
  const url = base.replace(/\/+$/, "") + "/supported";
  const hit = cache.get(url);
  if (hit) return hit;
  const p = (async () => {
    try {
      const res = await fetchImpl(url, {
        headers: { "user-agent": ua, accept: "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) return { error: `GET ${url} -> HTTP ${res.status}` };
      const j = (await res.json()) as Supported;
      if (!Array.isArray(j.kinds)) return { error: `GET ${url}: no kinds[]` };
      return j;
    } catch (e) {
      return { error: `GET ${url}: ${(e as Error).message}` };
    }
  })();
  cache.set(url, p);
  // Failed fetches are not cached, so a transient facilitator outage doesn't stick for the whole scan.
  void p.then((r) => {
    if ("error" in r) cache.delete(url);
  });
  return p;
}

export function clearSupportedCache() {
  cache.clear();
}

/**
 * Every signer the facilitator lists for this network in /supported `signers`, keyed by CAIP-2
 * family ("solana:*") or exact network. Undefined when the response has no signers map (v1-era
 * facilitators), so the caller can tell "not listed" from "not told".
 */
function signersFor(sup: Supported, a: NormalizedRequirement): string[] | undefined {
  if (!sup.signers || typeof sup.signers !== "object") return undefined;
  const ns = a.caip2?.split(":")[0];
  const keys = [a.caip2, a.network, ns ? `${ns}:*` : undefined].filter((k): k is string => !!k);
  const found = keys.flatMap((k) => (Array.isArray(sup.signers![k]) ? sup.signers![k] : []));
  return keys.some((k) => k in sup.signers!) ? found : undefined;
}

function matches(k: SupportedKind, a: NormalizedRequirement, version: number): boolean {
  if (k.scheme !== a.scheme) return false;
  const net = a.network;
  return (k.network === net || k.network === a.caip2) && (k.x402Version === version || k.x402Version === undefined);
}

export async function checkFacilitator(
  accepts: NormalizedRequirement[],
  version: number,
  opts: { facilitator?: string; publicFacilitators: string[]; fetchImpl: typeof fetch; userAgent: string; checkPublic: boolean },
): Promise<Check[]> {
  const out: Check[] = [];
  if (opts.facilitator) {
    const sup = await fetchSupported(opts.facilitator, opts.fetchImpl, opts.userAgent);
    if ("error" in sup) {
      out.push({
        id: "facilitator.supported",
        category: C,
        status: "unknown",
        title: "Facilitator supports this payment",
        message: `Couldn't read facilitator /supported: ${sup.error}`,
        fix: "Check the facilitator URL.",
      });
      return out;
    }
    for (const a of accepts) {
      const k = sup.kinds.find((k) => matches(k, a, version));
      const tag = `accepts[${a.index}]`;
      if (!k) {
        const sameNet = sup.kinds
          .filter((k) => k.network === a.network || k.network === a.caip2)
          .map((k) => `${k.scheme}/v${k.x402Version}`);
        out.push({
          id: "facilitator.supported",
          category: C,
          status: "fail",
          critical: true,
          accept: a.index,
          title: "Facilitator supports this payment",
          message: `${opts.facilitator} doesn't list ${a.scheme} on ${a.network} for x402 v${version}.${sameNet.length ? ` It supports ${sameNet.join(", ")} there.` : ""}`,
          fix: "Use a facilitator that supports this scheme/network, or change the requirement to one it supports.",
        });
        continue;
      }
      out.push({
        id: "facilitator.supported",
        category: C,
        status: "pass",
        accept: a.index,
        title: "Facilitator supports this payment",
        message: `${tag} ${a.scheme} on ${labelFor(a.caip2, a.network)} is supported by ${opts.facilitator}.`,
      });
      // The reference SVM facilitator (@x402/svm getExtra) advertises ONE fee payer picked at random
      // per /supported call, but /verify accepts any address it manages, and lists them all under
      // /supported `signers` ("solana:*"). So compare against the full signer list, not kinds[].extra.
      const fp = a.extra?.feePayer;
      const facFp = k.extra?.feePayer;
      if (typeof fp === "string" && typeof facFp === "string" && fp !== facFp) {
        const signers = signersFor(sup, a);
        if (signers?.includes(fp)) {
          out.push({
            id: "facilitator.feepayer",
            category: C,
            status: "pass",
            accept: a.index,
            title: "feePayer matches the facilitator",
            message: `${tag} extra.feePayer ${fp} is one of the facilitator's ${signers.length} fee payers.`,
          });
        } else if (signers) {
          out.push({
            id: "facilitator.feepayer",
            category: C,
            status: "fail",
            critical: true,
            accept: a.index,
            title: "feePayer matches the facilitator",
            message: `${tag} extra.feePayer ${fp} isn't one of the facilitator's fee payers (${signers.join(", ")}); it won't co-sign the transaction.`,
            fix: `Set extra.feePayer to ${facFp} (read it from /supported at startup instead of hardcoding).`,
          });
        } else {
          out.push({
            id: "facilitator.feepayer",
            category: C,
            status: "unknown",
            accept: a.index,
            title: "feePayer matches the facilitator",
            message: `${tag} extra.feePayer ${fp} differs from the fee payer /supported advertised (${facFp}), and /supported doesn't list all its signers. Facilitators that rotate fee payers advertise one at random, so this can't be confirmed either way.`,
            fix: `If the facilitator has a single fee payer, set extra.feePayer to ${facFp}.`,
          });
        }
      }
    }
    return out;
  }
  if (!opts.checkPublic) {
    out.push({
      id: "facilitator.supported",
      category: C,
      status: "skip",
      title: "Facilitator supports this payment",
      message: "No facilitator given (pass --facilitator <url> to check /supported).",
    });
    return out;
  }
  // Informational: which public facilitators could settle this?
  const results = await Promise.all(
    opts.publicFacilitators.map(async (f) => [f, await fetchSupported(f, opts.fetchImpl, opts.userAgent)] as const),
  );
  for (const a of accepts) {
    const ok = results.filter(([, s]) => !("error" in s) && s.kinds.some((k) => matches(k, a, version))).map(([f]) => f);
    out.push({
      id: "facilitator.public",
      category: C,
      status: "skip",
      accept: a.index,
      title: "Public facilitators for this payment",
      message: ok.length
        ? `accepts[${a.index}] ${a.scheme} on ${labelFor(a.caip2, a.network)} is settleable by ${ok.join(", ")}.`
        : `accepts[${a.index}] ${a.scheme} on ${labelFor(a.caip2, a.network)}: none of the keyless public facilitators list it (CDP needs an API key; pass --facilitator to check yours).`,
      data: { facilitators: ok },
    });
  }
  return out;
}
