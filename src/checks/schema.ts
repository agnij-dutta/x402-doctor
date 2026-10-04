import type { Challenge, Check, NormalizedRequirement } from "../types.js";
import { CAIP2_REGEX, KNOWN_SCHEMES, V1_NETWORKS, namespaceOf } from "../networks.js";

const C = "schema" as const;

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

export function checkSchema(ch: Challenge, requestedUrl: string): Check[] {
  const out: Check[] = [];
  const v = ch.version;

  // ---- top level ----
  if (!Array.isArray(ch.raw.accepts) || ch.accepts.length === 0) {
    out.push({
      id: "schema.accepts",
      category: C,
      status: "fail",
      critical: true,
      title: "accepts[] lists payment options",
      message: Array.isArray(ch.raw.accepts) ? "accepts[] is empty: there is no way to pay." : "accepts is missing or not an array.",
      fix: "Include at least one PaymentRequirements object in accepts[].",
    });
    return out;
  }
  out.push({
    id: "schema.accepts",
    category: C,
    status: "pass",
    title: "accepts[] lists payment options",
    message: `${ch.accepts.length} payment option(s).`,
  });

  if (v === 2) {
    const res = ch.raw.resource;
    if (!isObj(res) || typeof res.url !== "string") {
      out.push({
        id: "schema.resource",
        category: C,
        status: "fail",
        title: "resource.url present",
        message:
          typeof res === "string"
            ? "v2 `resource` must be an object {url, description?, mimeType?}, got a string (v1 shape)."
            : "v2 PaymentRequired is missing resource.url.",
        fix: 'Set resource: { url: "<this endpoint URL>", description, mimeType }.',
      });
    }
  }
  if (ch.resourceUrl) out.push(resourceUrlCheck(ch.resourceUrl, requestedUrl));

  // ---- per requirement ----
  for (const a of ch.accepts) out.push(...checkRequirement(a, v));
  return out;
}

function resourceUrlCheck(declared: string, requested: string): Check {
  const base = { id: "schema.resource-url", category: C, title: "resource URL matches the request" } as const;
  let d: URL, r: URL;
  try {
    d = new URL(declared);
    r = new URL(requested);
  } catch {
    return {
      ...base,
      status: "warn",
      message: `resource URL "${declared}" is not an absolute URL.`,
      fix: "Use the absolute public URL of the endpoint.",
    };
  }
  const norm = (u: URL) => u.host + u.pathname.replace(/\/+$/, "");
  if (d.href === r.href || (norm(d) === norm(r) && d.protocol === r.protocol)) {
    return { ...base, status: "pass", message: `resource URL matches (${declared}).` };
  }
  if (norm(d) === norm(r) && d.protocol !== r.protocol) {
    return {
      ...base,
      status: "warn",
      message: `resource URL is ${d.protocol}// but the endpoint is served over ${r.protocol}//. Usually a TLS-terminating proxy; the receipt and catalog entry will point at the wrong URL.`,
      fix: "Build resource.url from the public origin (or trust X-Forwarded-Proto), not from the internal request.",
      data: { declared, requested },
    };
  }
  if (d.host !== r.host) {
    return {
      ...base,
      status: "warn",
      message: `resource URL host "${d.host}" differs from the requested host "${r.host}" (localhost/internal host leaking, or a shared config).`,
      fix: "Set resource.url to the public URL clients actually call.",
      data: { declared, requested },
    };
  }
  return {
    ...base,
    status: "warn",
    message: `resource URL path "${d.pathname}" differs from requested "${r.pathname}".`,
    fix: "Set resource.url to the exact route being paid for, so receipts and discovery entries point at the right thing.",
    data: { declared, requested },
  };
}

function checkRequirement(a: NormalizedRequirement, v: number): Check[] {
  const out: Check[] = [];
  const i = a.index;
  const r = a.raw;
  const tag = `accepts[${i}]`;

  // required fields
  const required =
    v === 1
      ? ["scheme", "network", "maxAmountRequired", "asset", "payTo", "resource", "description", "maxTimeoutSeconds"]
      : ["scheme", "network", "amount", "asset", "payTo", "maxTimeoutSeconds"];
  // v1 `description` is z.string() in the reference schema (@x402/core PaymentRequirementsV1Schema) and
  // the legacy middleware defaults it to "", so an empty description is present, not missing.
  const emptyOk = new Set(["description"]);
  const missing = required.filter((k) => r[k] === undefined || r[k] === null || (r[k] === "" && !emptyOk.has(k)));

  // v1 vs v2 amount field naming
  if (v === 2 && r.amount === undefined && r.maxAmountRequired !== undefined) {
    out.push({
      id: "schema.amount-field",
      category: C,
      status: "fail",
      critical: true,
      accept: i,
      title: "Amount uses the right field name",
      message: `${tag} uses v1 field \`maxAmountRequired\` in a v2 challenge. v2 clients read \`amount\` and will see undefined.`,
      fix: "Rename maxAmountRequired to amount for x402Version 2.",
    });
  } else if (v === 1 && r.maxAmountRequired === undefined && r.amount !== undefined) {
    out.push({
      id: "schema.amount-field",
      category: C,
      status: "fail",
      critical: true,
      accept: i,
      title: "Amount uses the right field name",
      message: `${tag} uses v2 field \`amount\` in a v1 challenge. v1 clients read \`maxAmountRequired\`.`,
      fix: "Rename amount to maxAmountRequired for x402Version 1, or upgrade the whole challenge to v2.",
    });
  }
  const missingReal = missing.filter((k) => !((k === "amount" || k === "maxAmountRequired") && a.amount !== undefined));
  if (missingReal.length) {
    const critical = missingReal.some((k) => ["scheme", "network", "amount", "maxAmountRequired", "asset", "payTo"].includes(k));
    out.push({
      id: "schema.required-fields",
      category: C,
      status: critical ? "fail" : "warn",
      critical,
      accept: i,
      title: "Required fields present",
      message: `${tag} is missing ${missingReal.join(", ")}.`,
      fix: `Add ${missingReal.join(", ")} (x402 v${v} PaymentRequirements).`,
      data: { missing: missingReal },
    });
  } else {
    out.push({
      id: "schema.required-fields",
      category: C,
      status: "pass",
      accept: i,
      title: "Required fields present",
      message: `${tag} has all required v${v} fields.`,
    });
  }

  // scheme
  if (a.scheme && !KNOWN_SCHEMES.includes(a.scheme)) {
    out.push({
      id: "schema.scheme",
      category: C,
      status: "warn",
      accept: i,
      title: "Known payment scheme",
      message: `${tag} scheme "${a.scheme}" is not one of ${KNOWN_SCHEMES.join(", ")}. Most clients will skip this option.`,
      fix: 'Use "exact" unless you know your clients support something else.',
    });
  }

  // network
  if (a.network !== undefined) {
    if (typeof r.network !== "string") {
      out.push({
        id: "schema.network",
        category: C,
        status: "fail",
        critical: true,
        accept: i,
        title: "Network identifier format",
        message: `${tag} network is not a string.`,
        fix: "Use a CAIP-2 string like eip155:8453.",
      });
    } else if (v === 2 && !CAIP2_REGEX.test(r.network) && r.network.length >= 3 && r.network.includes(":")) {
      // namespace:reference shape that breaks the strict CAIP-2 grammar: Algorand's full base64 genesis
      // hash ("=", > 32 chars), or a namespace longer than 8 chars ("hyperliquid:mainnet"). The reference
      // schema (@x402/core NetworkSchemaV2) only requires >= 3 chars and a ":", so this is not a v1 name.
      out.push({
        id: "schema.network",
        category: C,
        status: "warn",
        accept: i,
        title: "Network identifier format",
        message: `${tag} network "${r.network}" is namespace:reference shaped but not strict CAIP-2 (namespace 3-8 chars of [-a-z0-9], reference 1-32 chars of [-_a-zA-Z0-9]).`,
        fix: "Use the chain's registered CAIP-2 id (see ChainAgnostic namespaces), if the facilitator accepts it.",
        data: { network: r.network },
      });
    } else if (v === 2 && !CAIP2_REGEX.test(r.network)) {
      const suggestion = V1_NETWORKS[r.network];
      out.push({
        id: "schema.network",
        category: C,
        status: "fail",
        critical: true,
        accept: i,
        title: "Network identifier format",
        message: `${tag} network "${r.network}" is a v1 name; v2 requires CAIP-2.`,
        fix: suggestion ? `Use "${suggestion}" instead of "${r.network}".` : "Use the CAIP-2 id, e.g. eip155:8453 for Base.",
        data: { network: r.network, suggestion },
      });
    } else if (v === 1 && CAIP2_REGEX.test(r.network)) {
      const name = Object.entries(V1_NETWORKS).find(([, c]) => c === r.network)?.[0];
      out.push({
        id: "schema.network",
        category: C,
        status: "fail",
        critical: true,
        accept: i,
        title: "Network identifier format",
        message: `${tag} uses CAIP-2 "${r.network}" in a v1 challenge; v1 clients expect network names.`,
        fix: name ? `Use "${name}", or upgrade the challenge to v2.` : "Upgrade the challenge to v2 (CAIP-2 networks are v2 only).",
      });
    } else if (!a.caip2) {
      out.push({
        id: "schema.network",
        category: C,
        status: "warn",
        accept: i,
        title: "Network identifier format",
        message: `${tag} network "${r.network}" is not a network x402-doctor recognizes.`,
        fix: "Double-check the network id against the x402 spec.",
      });
    } else {
      out.push({
        id: "schema.network",
        category: C,
        status: "pass",
        accept: i,
        title: "Network identifier format",
        message: `${tag} network ${r.network}.`,
      });
    }
  }

  // amount format
  // The atomic-integer rule is specified for EVM and Solana. Other families (XRPL issued currencies,
  // Hyperliquid, ...) define their own amount encoding, so we don't judge decimal strings there.
  const amountNs = namespaceOf(a.caip2);
  const atomicRule = amountNs === "eip155" || amountNs === "solana";
  if (a.amount !== undefined) {
    const amt = a.amount;
    const field = v === 1 ? "maxAmountRequired" : "amount";
    if (!atomicRule && typeof amt === "string" && /^\d+(\.\d+)?$/.test(amt)) {
      out.push({
        id: "schema.amount-format",
        category: C,
        status: "skip",
        accept: i,
        title: "Amount is an atomic-unit integer string",
        message: `${tag} ${field} "${amt}" on ${a.caip2 ?? String(r.network)}: amount encoding for this network family isn't checked.`,
      });
    } else if (typeof amt === "number") {
      out.push({
        id: "schema.amount-format",
        category: C,
        status: "fail",
        critical: true,
        accept: i,
        title: "Amount is an atomic-unit integer string",
        message: `${tag} ${field} is a JSON number (${amt}); the spec requires a string of atomic units. Large values lose precision and strict clients reject it.`,
        fix: Number.isInteger(amt)
          ? `Send "${amt}" as a string.`
          : `Convert to atomic units: for a 6-decimal token, $${amt} is "${Math.round(amt * 1e6)}".`,
      });
    } else if (typeof amt !== "string" || !/^\d+$/.test(amt)) {
      const s = typeof amt === "string" ? amt : (JSON.stringify(amt) ?? "undefined");
      const dollars = /^\$?\d*\.\d+$/.test(s) || s.startsWith("$");
      out.push({
        id: "schema.amount-format",
        category: C,
        status: "fail",
        critical: true,
        accept: i,
        title: "Amount is an atomic-unit integer string",
        message: `${tag} ${field} is "${s}". It must be an integer string in the token's smallest unit${dollars ? " (looks like a dollar/decimal amount)" : ""}.`,
        fix: dollars
          ? `For USDC (6 decimals), $${s.replace("$", "")} = "${Math.round(Number(s.replace("$", "")) * 1e6)}".`
          : 'Use an integer string such as "10000" (= $0.01 USDC).',
        data: { amount: s },
      });
    } else if (/^0+$/.test(amt)) {
      out.push({
        id: "schema.amount-format",
        category: C,
        status: "warn",
        accept: i,
        title: "Amount is an atomic-unit integer string",
        message: `${tag} ${field} is 0. A free route doesn't need x402.`,
        fix: "Charge a non-zero amount or remove the paywall.",
      });
    } else if (amt.length > 1 && amt.startsWith("0")) {
      out.push({
        id: "schema.amount-format",
        category: C,
        status: "warn",
        accept: i,
        title: "Amount is an atomic-unit integer string",
        message: `${tag} ${field} "${amt}" has leading zeros.`,
        fix: `Use "${BigInt(amt).toString()}".`,
      });
    } else {
      out.push({
        id: "schema.amount-format",
        category: C,
        status: "pass",
        accept: i,
        title: "Amount is an atomic-unit integer string",
        message: `${tag} ${field} = ${amt}.`,
      });
    }
  }

  // maxTimeoutSeconds
  if (a.maxTimeoutSeconds !== undefined) {
    const t = a.maxTimeoutSeconds;
    // Integer required even though the reference schema accepts any positive number: the EVM client
    // signs validBefore = (now + maxTimeoutSeconds).toString(), and "1759600060.5" is not a uint256.
    if (typeof t !== "number" || !Number.isFinite(t) || !Number.isInteger(t) || t <= 0) {
      out.push({
        id: "schema.timeout",
        category: C,
        status: "fail",
        accept: i,
        title: "maxTimeoutSeconds is sane",
        message: `${tag} maxTimeoutSeconds is ${JSON.stringify(t)}; must be a positive integer number of seconds.`,
        fix: "Use a number like 60 (not a string).",
        critical: typeof t === "string" ? false : true,
      });
    } else if (t < 10) {
      out.push({
        id: "schema.timeout",
        category: C,
        status: "warn",
        accept: i,
        title: "maxTimeoutSeconds is sane",
        message: `${tag} maxTimeoutSeconds is ${t}s. Clients set validBefore = now + maxTimeoutSeconds, so a slow wallet or busy facilitator will see the authorization expire before settlement.`,
        fix: "Use 30 to 300 seconds.",
      });
    } else if (t > 3600) {
      out.push({
        id: "schema.timeout",
        category: C,
        status: "warn",
        accept: i,
        title: "maxTimeoutSeconds is sane",
        message: `${tag} maxTimeoutSeconds is ${t}s (${(t / 3600).toFixed(1)}h). A long-lived signed authorization can be settled long after the client gave up.`,
        fix: "Keep it at or below 300s for per-request payments.",
      });
    } else {
      out.push({
        id: "schema.timeout",
        category: C,
        status: "pass",
        accept: i,
        title: "maxTimeoutSeconds is sane",
        message: `${tag} maxTimeoutSeconds ${t}s.`,
      });
    }
  }

  // extra
  if (r.extra !== undefined && !isObj(r.extra)) {
    out.push({
      id: "schema.extra",
      category: C,
      status: "fail",
      accept: i,
      title: "extra is an object",
      message: `${tag} extra is ${typeof r.extra}.`,
      fix: "extra must be a JSON object.",
      critical: true,
    });
  }
  const ns = namespaceOf(a.caip2);
  if (ns === "eip155" && (a.scheme === "exact" || a.scheme === "upto")) {
    const method = (a.extra?.assetTransferMethod as string | undefined) ?? "eip3009";
    if (
      method === "eip3009" &&
      a.scheme === "exact" &&
      (!a.extra || typeof a.extra.name !== "string" || typeof a.extra.version !== "string")
    ) {
      out.push({
        id: "schema.eip712-extra",
        category: C,
        status: "fail",
        critical: true,
        accept: i,
        title: "EIP-712 domain in extra",
        message: `${tag} is EVM exact/eip3009 but extra.name / extra.version are missing. The reference client refuses to sign without them.`,
        fix: 'Add extra: { name, version } matching the token\'s EIP-712 domain (Base USDC: { name: "USD Coin", version: "2" }).',
      });
    }
    if (!["eip3009", "permit2", "erc7710"].includes(method)) {
      out.push({
        id: "schema.transfer-method",
        category: C,
        status: "warn",
        accept: i,
        title: "assetTransferMethod is valid",
        message: `${tag} extra.assetTransferMethod "${method}" is not in the spec (eip3009, permit2, erc7710). Only clients and facilitators that know this extension can pay with it.`,
        fix: "Use one of eip3009 (default), permit2, erc7710, or also offer a spec option.",
      });
    }
  }
  if (ns === "solana" && a.scheme === "exact" && (!a.extra || typeof a.extra.feePayer !== "string")) {
    out.push({
      id: "schema.svm-feepayer",
      category: C,
      status: "fail",
      critical: true,
      accept: i,
      title: "SVM extra.feePayer present",
      message: `${tag} is Solana exact but extra.feePayer is missing; clients can't build the transaction.`,
      fix: "Copy the facilitator's feePayer from its /supported response into extra.feePayer.",
    });
  }
  return out;
}
