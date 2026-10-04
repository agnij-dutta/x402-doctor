// Focused x402 challenge parsing: v2 PAYMENT-REQUIRED header (base64 JSON) and v1 JSON body.
// Spec: x402-foundation/x402 specs/x402-specification-v2.md (transport) and specs/schemes/exact/.
import type { Challenge, NormalizedRequirement } from "./types.js";
import { toCaip2 } from "./networks.js";

/** Same regex the reference client (@x402/core utils Base64EncodedRegex) applies before decoding. */
export const STD_BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
export const URL_BASE64 = /^[A-Za-z0-9_-]*={0,2}$/;

export type HeaderDecode =
  | { ok: true; json: Record<string, unknown>; encoding: "base64" | "base64url" }
  | { ok: false; stage: "encoding" | "json" | "shape"; error: string; encoding?: "base64" | "base64url" };

/**
 * Decode a v2 PAYMENT-REQUIRED header value. The spec and the reference client use standard base64;
 * base64url decodes here too but is reported, because the reference client rejects it.
 */
export function decodeHeaderValue(value: string): HeaderDecode {
  const v = value.trim();
  let encoding: "base64" | "base64url";
  if (STD_BASE64.test(v)) encoding = "base64";
  else if (URL_BASE64.test(v)) encoding = "base64url";
  else {
    // maybe raw JSON
    if (v.startsWith("{")) return { ok: false, stage: "encoding", error: "header contains raw JSON, not base64" };
    return { ok: false, stage: "encoding", error: "header is not valid base64" };
  }
  let text: string;
  try {
    text = Buffer.from(v, encoding === "base64" ? "base64" : "base64url").toString("utf8");
  } catch (e) {
    return { ok: false, stage: "encoding", error: String(e), encoding };
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, stage: "json", error: "base64 decodes but the result is not JSON", encoding };
  }
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    return { ok: false, stage: "shape", error: "decoded JSON is not an object", encoding };
  }
  return { ok: true, json: json as Record<string, unknown>, encoding };
}

/** Parse JSON, returning undefined unless the result is a plain object. */
export function tryParseJson(text: string): Record<string, unknown> | undefined {
  try {
    const j: unknown = JSON.parse(text);
    return j && typeof j === "object" && !Array.isArray(j) ? (j as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/** Normalize one accepts[] entry across v1 (maxAmountRequired, network names) and v2 (amount, CAIP-2). */
export function normalizeRequirement(raw: unknown, index: number, version: number): NormalizedRequirement {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const network = typeof r.network === "string" ? r.network : undefined;
  const amount = version === 1 ? (r.maxAmountRequired ?? r.amount) : (r.amount ?? r.maxAmountRequired);
  return {
    index,
    scheme: typeof r.scheme === "string" ? r.scheme : undefined,
    network,
    caip2: network ? toCaip2(network) : undefined,
    amount,
    asset: r.asset,
    payTo: r.payTo,
    maxTimeoutSeconds: r.maxTimeoutSeconds,
    extra: r.extra && typeof r.extra === "object" && !Array.isArray(r.extra) ? (r.extra as Record<string, unknown>) : undefined,
    raw: r,
  };
}

/** Build a Challenge from a parsed header or body object, normalizing every accepts[] entry. */
export function buildChallenge(json: Record<string, unknown>, source: "header" | "body"): Challenge {
  const version = typeof json.x402Version === "number" ? json.x402Version : NaN;
  const acceptsRaw = Array.isArray(json.accepts) ? json.accepts : [];
  const accepts = acceptsRaw.map((a, i) => normalizeRequirement(a, i, version));
  let resourceUrl: string | undefined;
  const res = json.resource;
  if (res && typeof res === "object" && typeof (res as { url?: unknown }).url === "string") {
    resourceUrl = (res as { url: string }).url;
  } else if (typeof res === "string") {
    resourceUrl = res;
  } else if (version === 1 && accepts[0] && typeof accepts[0].raw.resource === "string") {
    resourceUrl = accepts[0].raw.resource;
  }
  return {
    version,
    source,
    raw: json,
    accepts,
    resourceUrl,
    extensions: json.extensions && typeof json.extensions === "object" ? (json.extensions as Record<string, unknown>) : undefined,
  };
}
