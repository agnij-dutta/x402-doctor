// Browser (CORS) readiness checks. They read the three probes doctor() already sends once the
// unpaid request returned 402, and never add requests of their own:
//   P1  the unpaid request, no Origin
//   P2  the same request with `Origin: <probe origin>`
//   P3  an OPTIONS preflight asking for the payment header (and Content-Type)
// Checks only fail when the endpoint opted into CORS (Allow-Origin on P2). An endpoint with no
// Allow-Origin gets a zero-penalty advisory: server-to-server endpoints are not punished.
import type { Check } from "../types.js";
import type { ProbeResponse } from "../http.js";
import { FIX_REFS, refText } from "./fixrefs.js";

/** The CORS-relevant headers of one probe response, recorded as evidence on `cors.allow-origin`. */
export interface ObservedResponse {
  /** HTTP status; 0 when no response was received. */
  status: number;
  allowOrigin: string | null;
  allowCredentials: string | null;
  exposeHeaders: string | null;
  allowHeaders: string | null;
  allowMethods: string | null;
  maxAge: string | null;
  vary: string | null;
  cacheControl: string | null;
  age: string | null;
  /** cf-cache-status and x-cache, joined with "; " when both are present. */
  cacheStatus: string | null;
  /** Whether the response carried a PAYMENT-REQUIRED header (its value is not recorded). */
  paymentRequired: boolean;
}

/** Evidence for the browser checks, written to `data.observed` of `cors.allow-origin`. */
export interface CorsObserved {
  /** Origin sent on P2 and P3. */
  origin: string;
  method: string;
  /** x402 version the checks used: 2 when the 402 has a v2 challenge, else 1. */
  version: number;
  /** v2 header plus a v1 JSON body: both header sets are expected. */
  dual: boolean;
  p1: ObservedResponse;
  p2?: ObservedResponse;
  p3?: ObservedResponse;
}

export function observe(r: ProbeResponse): ObservedResponse;
export function observe(r: ProbeResponse | undefined): ObservedResponse | undefined;
export function observe(r: ProbeResponse | undefined): ObservedResponse | undefined {
  if (!r) return undefined;
  const h = (n: string) => r.headers.get(n);
  const cacheStatus = [h("cf-cache-status"), h("x-cache")].filter((x): x is string => !!x).join("; ");
  return {
    status: r.ok ? r.status : 0,
    allowOrigin: h("access-control-allow-origin"),
    allowCredentials: h("access-control-allow-credentials"),
    exposeHeaders: h("access-control-expose-headers"),
    allowHeaders: h("access-control-allow-headers"),
    allowMethods: h("access-control-allow-methods"),
    maxAge: h("access-control-max-age"),
    vary: h("vary"),
    cacheControl: h("cache-control"),
    age: h("age"),
    cacheStatus: cacheStatus || null,
    paymentRequired: h("payment-required") !== null,
  };
}

const B = "browser" as const;
const BODY_METHODS = new Set(["POST", "PUT", "PATCH"]);
const SIMPLE_METHODS = new Set(["GET", "HEAD", "POST"]);
/** The checks that decide `browser.status = ready`. */
export const BROWSER_CORE = [
  "cors.allow-origin",
  "cors.allow-origin-single",
  "handshake.cors-expose",
  "handshake.cors-preflight",
  "cors.preflight-not-charged",
] as const;

/** A probe that produced a response we can judge (not a network error, rate limit or 5xx). */
export const usable = (o: ObservedResponse | undefined): o is ObservedResponse => !!o && o.status > 0 && o.status !== 429 && o.status < 500;

const tokens = (list: string | null) =>
  (list ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
const named = (list: string | null, name: string) => tokens(list).includes(name.toLowerCase());
const hasStar = (list: string | null) => tokens(list).includes("*");
/** Credentials are allowed when any value is "true" (a duplicated "true, true" still reads as credentialed). */
const credentialed = (v: string | null) => tokens(v).includes("true");
/** Named, or covered by `*` (which browsers ignore on a credentialed request). */
const allowed = (list: string | null, name: string, cred: boolean) => named(list, name) || (hasStar(list) && !cred);

function isOrigin(v: string): boolean {
  try {
    return new URL(v).origin === v;
  } catch {
    return false;
  }
}

const ALLOW_ORIGIN_FIX =
  "Send `Access-Control-Allow-Origin` on the 402 itself, from your app's CORS layer (x402 middlewares never set it). Mount CORS so that it also runs on responses produced by the payment middleware. Express: `app.use(cors(...))` before `paymentMiddleware`. Flask: wrap at the WSGI level, because flask-cors never sees the 402.";

function exposeFix(): string {
  return (
    "Add `Access-Control-Expose-Headers: PAYMENT-REQUIRED, PAYMENT-RESPONSE`, merged with any existing value, on every response of paid routes, including the 402. " +
    `TypeScript SDK: the fix is ${refText(FIX_REFS.exposeTs)}. Python and Go SDKs: ${refText(FIX_REFS.exposePyGo)}; note that Starlette's \`CORSMiddleware(expose_headers=...)\` replaces the list instead of merging. ` +
    `Spec: ${refText(FIX_REFS.spec)}.`
  );
}

/**
 * The legacy `data.cors` bucket of `handshake.cors-expose` (none, no-expose, partial, ok), computed
 * exactly as x402-doctor 0.1.x did so the scan histogram stays comparable across versions.
 */
export function exposeBucket(p2: ObservedResponse, version: number): "none" | "no-expose" | "partial" | "ok" {
  const acao = p2.allowOrigin;
  if (!acao) return "none";
  const acac = (p2.allowCredentials ?? "").toLowerCase() === "true";
  const expose = p2.exposeHeaders;
  const listHas = (n: string) => tokens(expose).some((s) => s === "*" || s === n.toLowerCase());
  const has = (n: string) => listHas(n) && !(acac && (expose ?? "").trim() === "*");
  if (version === 2) {
    if (!has("PAYMENT-REQUIRED")) return "no-expose";
    return has("PAYMENT-RESPONSE") ? "ok" : "partial";
  }
  return has("X-PAYMENT-RESPONSE") ? "ok" : "partial";
}

/** The single skip check emitted instead of the browser checks under --server-only. */
export function serverOnlyCheck(): Check {
  return {
    id: "cors.allow-origin",
    category: B,
    status: "skip",
    title: "Browser checks",
    message: "Browser (CORS) checks skipped (--server-only).",
    data: { browser: "server-only" },
  };
}

/** All browser (CORS) checks, from the recorded probe evidence. */
export function checkCors(o: CorsObserved): Check[] {
  const out: Check[] = [];
  const { p1, p2, p3, origin } = o;
  const v2 = o.version === 2;

  // ---- C1. cors.allow-origin ----
  const c1 = { id: "cors.allow-origin", category: B, title: "The 402 answers an Origin request with a usable Allow-Origin" };
  if (!usable(p2)) {
    out.push({ ...c1, status: "skip", message: "CORS probe inconclusive.", data: { browser: "unknown", observed: o } });
    out.push({
      id: "handshake.cors-expose",
      category: B,
      status: "skip",
      title: "CORS exposes x402 headers",
      message: "CORS probe inconclusive.",
    });
    return out;
  }
  const acao = p2.allowOrigin ? p2.allowOrigin.trim() : null;
  const cred = credentialed(p2.allowCredentials);
  const refused = p1.status === 402 && (p2.status === 401 || p2.status === 403);
  if (refused) {
    out.push({
      ...c1,
      status: "skip",
      message: `The unpaid request returns 402, but the same request with an Origin header returns ${p2.status}: this endpoint refuses browser origins. That is allowed by the spec; it controls who can read the 402, not who can spend.`,
      data: { browser: "refused", observed: o },
    });
  } else if (!acao) {
    out.push({
      ...c1,
      status: "warn",
      penalty: 0,
      message:
        "No Access-Control-Allow-Origin on the 402: browsers can't call this; fine if it is server-to-server only (advisory, no score impact; --server-only silences it).",
      fix: ALLOW_ORIGIN_FIX,
      data: { browser: "none", observed: o },
    });
  } else if (acao.includes(",")) {
    out.push({
      ...c1,
      status: "skip",
      message: `Allow-Origin has several values ("${acao}"); see cors.allow-origin-single.`,
      data: { allowOrigin: "duplicated", observed: o },
    });
  } else if (acao === "*") {
    out.push(
      cred
        ? {
            ...c1,
            status: "warn",
            message:
              "Allow-Origin is `*` together with `Access-Control-Allow-Credentials: true`. Browsers reject `*` on credentialed requests, so callers that send cookies or Authorization are blocked.",
            fix: "Reflect the caller's origin (with `Vary: Origin`) instead of `*` when credentials are allowed, or drop `Access-Control-Allow-Credentials` if paid routes don't use cookies.",
            data: { allowOrigin: "star", observed: o },
          }
        : { ...c1, status: "pass", message: "Allow-Origin: * on the 402.", data: { allowOrigin: "star", observed: o } },
    );
  } else if (acao === origin) {
    out.push({
      ...c1,
      status: "pass",
      message: `Allow-Origin reflects the probe origin (${origin}).`,
      data: { allowOrigin: "reflected", observed: o },
    });
  } else if (acao !== "null" && isOrigin(acao)) {
    out.push({
      ...c1,
      status: "skip",
      message: `Allow-Origin is a fixed origin (${acao}), not the probe origin, so the browser checks were judged for an origin they don't cover.`,
      fix: `Re-run with \`--origin ${acao}\` (or your real frontend origin) to check it as that origin.`,
      data: { browser: "restricted", allowOrigin: "fixed-other", observed: o },
    });
  } else {
    out.push({
      ...c1,
      status: "fail",
      message: `Allow-Origin is "${acao}", which is neither \`*\` nor a valid origin. Browsers reject it, so fetch() can't read the 402.`,
      fix: `Send \`*\` or the caller's exact origin (scheme://host[:port], no path or trailing slash). ${ALLOW_ORIGIN_FIX}`,
      data: { allowOrigin: "invalid", observed: o },
    });
  }

  const corsOn = !refused && !!acao;
  if (!corsOn) {
    // Bucket recorded as before so the scan's CORS histogram is unchanged.
    out.push({
      id: "handshake.cors-expose",
      category: B,
      status: "skip",
      title: "CORS exposes x402 headers",
      message: refused ? "Browser origins are refused; not judged." : "No CORS on the 402; not judged.",
      data: { cors: exposeBucket(p2, o.version) },
    });
    return out;
  }

  // ---- C2. cors.allow-origin-single ----
  const dups: string[] = [];
  if (acao.includes(",")) dups.push(`the 402's Allow-Origin ("${acao}")`);
  if ((p2.allowCredentials ?? "").includes(",")) dups.push(`the 402's Allow-Credentials ("${p2.allowCredentials}")`);
  if (usable(p3) && (p3.allowOrigin ?? "").includes(",")) dups.push(`the preflight's Allow-Origin ("${p3.allowOrigin}")`);
  if (usable(p3) && (p3.allowCredentials ?? "").includes(",")) dups.push(`the preflight's Allow-Credentials ("${p3.allowCredentials}")`);
  out.push(
    dups.length
      ? {
          id: "cors.allow-origin-single",
          category: B,
          status: "fail",
          title: "Exactly one Allow-Origin value",
          message: `Several values in ${dups.join(" and ")}. Browsers reject a multi-valued Allow-Origin (the \`*, *\` trap), so the response is unreadable even though curl without Origin looks fine.`,
          fix: "Two layers both set Allow-Origin (often an edge plus the origin, or an object spread of `Headers` with differently cased keys). Set it in one layer only, with `Headers.set()`, which dedupes case-insensitively.",
          data: { where: dups },
        }
      : {
          id: "cors.allow-origin-single",
          category: B,
          status: "pass",
          title: "Exactly one Allow-Origin value",
          message: "Allow-Origin has a single value.",
        },
  );

  // ---- C3. handshake.cors-expose ----
  const bucket = exposeBucket(p2, o.version);
  const c3 = { id: "handshake.cors-expose", category: B, title: "CORS exposes x402 headers" };
  if (v2) {
    const expose = p2.exposeHeaders;
    if (!allowed(expose, "PAYMENT-REQUIRED", cred)) {
      const wild = hasStar(expose) && cred;
      out.push({
        ...c3,
        status: "fail",
        message: wild
          ? "Access-Control-Expose-Headers is `*` with `Access-Control-Allow-Credentials: true`; browsers ignore `*` then, so they hide PAYMENT-REQUIRED from fetch() and browser clients see a 402 with no price."
          : `CORS is enabled (Allow-Origin: ${acao}) but Access-Control-Expose-Headers ${expose ? `is "${expose}"` : "is missing"}. Browsers hide PAYMENT-REQUIRED from fetch(), so browser clients see a 402 with no price and can't pay.`,
        fix: exposeFix(),
        data: { cors: bucket, reason: wild ? "wildcard-credentialed" : "not-exposed", acao, expose },
      });
    } else if (p1.paymentRequired && !p2.paymentRequired) {
      out.push({
        ...c3,
        status: "fail",
        message: `The 402 carries PAYMENT-REQUIRED without an Origin header, but not when Origin is sent (status ${p2.status}). Something in front of the app (an edge or proxy) strips it from cross-origin responses.`,
        fix: "Make the edge pass PAYMENT-REQUIRED through on responses to requests with an Origin header, and expose it with `Access-Control-Expose-Headers`.",
        data: { cors: bucket, reason: "stripped-with-origin", acao, expose },
      });
    } else {
      out.push({ ...c3, status: "pass", message: `PAYMENT-REQUIRED is exposed (${expose}).`, data: { cors: bucket } });
    }
  } else {
    out.push({
      ...c3,
      status: "pass",
      message: "The v1 challenge is in the JSON body, which browsers can read once Allow-Origin is set.",
      data: { cors: bucket },
    });
  }

  // ---- C4. cors.expose-payment-response ----
  const receipts = v2 ? (o.dual ? ["PAYMENT-RESPONSE", "X-PAYMENT-RESPONSE"] : ["PAYMENT-RESPONSE"]) : ["X-PAYMENT-RESPONSE"];
  const missingReceipts = receipts.filter((n) => !allowed(p2.exposeHeaders, n, cred));
  const c3Failed = out[out.length - 1]!.status === "fail";
  out.push(
    c3Failed
      ? {
          id: "cors.expose-payment-response",
          category: B,
          status: "skip",
          title: "The settlement receipt will be readable",
          message: "Not judged: the challenge itself isn't readable yet (see handshake.cors-expose).",
        }
      : missingReceipts.length
        ? {
            id: "cors.expose-payment-response",
            category: B,
            status: "warn",
            title: "The settlement receipt will be readable",
            message: `${missingReceipts.join(" and ")} ${missingReceipts.length > 1 ? "are" : "is"} not named in Access-Control-Expose-Headers on the 402, so browser clients likely won't see the settlement receipt after paying. (Checked on the 402 as a proxy: x402-doctor never pays, so the paid response itself was not checked.)`,
            fix: `Expose ${receipts.join(" and ")} on paid routes: \`Access-Control-Expose-Headers: ${v2 ? "PAYMENT-REQUIRED, " : ""}${receipts.join(", ")}\`, merged with any existing value.`,
            data: { missing: missingReceipts },
          }
        : {
            id: "cors.expose-payment-response",
            category: B,
            status: "pass",
            title: "The settlement receipt will be readable",
            message: `${receipts.join(" and ")} named on the 402; the paid response itself was not checked.`,
          },
  );

  // ---- C5. handshake.cors-preflight / C6. cors.preflight-not-charged ----
  const c5 = { id: "handshake.cors-preflight", category: B, title: "CORS preflight allows the payment header" };
  const c6 = { id: "cors.preflight-not-charged", category: B, title: "The CORS preflight is not charged" };
  let preflightOk = false;
  if (!usable(p3)) {
    out.push({ ...c5, status: "skip", message: "Preflight probe inconclusive." });
  } else if (p3.status === 402) {
    out.push({
      ...c5,
      status: "skip",
      message: "The preflight answered 402; see cors.preflight-not-charged.",
      data: { allowHeaders: p3.allowHeaders, status: 402 },
    });
    out.push({
      ...c6,
      status: "fail",
      message: p3.paymentRequired
        ? "The OPTIONS preflight returned 402 with a PAYMENT-REQUIRED challenge: the x402 middleware is charging the CORS preflight, so browsers block every paid request before it is sent."
        : "The OPTIONS preflight returned 402. Browsers require a 2xx preflight, so they block every paid request before it is sent.",
      fix: `Key paid routes with their method (\`"GET /path"\`, not \`"/path"\`). A single route config, or a pattern without a method, registers verb \`*\`, which matches \`OPTIONS\`. The SDK fix is ${refText(FIX_REFS.preflightRoute)}: \`OPTIONS\` never matches a \`*\` route. Hand-written paywalls: answer \`OPTIONS\` before the payment check.`,
      data: { status: 402, chargedWithChallenge: p3.paymentRequired },
    });
  } else {
    const pcred = credentialed(p3.allowCredentials);
    const allowH = p3.allowHeaders;
    const payHeaders = v2 ? (o.dual ? ["PAYMENT-SIGNATURE", "X-PAYMENT"] : ["PAYMENT-SIGNATURE"]) : ["X-PAYMENT"];
    const reasons: string[] = [];
    const notes: string[] = [];
    if (p3.status < 200 || p3.status > 299) {
      reasons.push(`non-2xx:${p3.status}`);
      notes.push(`returned ${p3.status}; browsers require a 2xx preflight, whatever its headers say`);
    } else {
      if (!p3.allowOrigin) {
        reasons.push("no-acao");
        notes.push("has no Access-Control-Allow-Origin");
      }
      const missing = payHeaders.filter((n) => !allowed(allowH, n, pcred));
      if (missing.length) {
        if (hasStar(allowH) && pcred) {
          reasons.push("wildcard-credentialed");
          notes.push("allows headers with `*`, which browsers ignore when `Access-Control-Allow-Credentials: true`");
        } else if (v2 && missing.includes("PAYMENT-SIGNATURE") && named(allowH, "X-PAYMENT")) {
          reasons.push("v1-only");
          notes.push("allows only the v1 X-PAYMENT header, but v2 clients send PAYMENT-SIGNATURE");
        } else {
          reasons.push("not-named");
          notes.push(
            `does not list ${missing.join(" and ")} in Access-Control-Allow-Headers (${allowH === null ? "missing" : `got "${allowH}"`})`,
          );
        }
      }
      if (BODY_METHODS.has(o.method) && !allowed(allowH, "Content-Type", pcred)) {
        reasons.push("content-type");
        notes.push("does not allow Content-Type, so a JSON request fails its preflight before the 402 is even served");
      }
      if (!SIMPLE_METHODS.has(o.method) && !(named(p3.allowMethods, o.method) || (hasStar(p3.allowMethods) && !pcred))) {
        reasons.push("method");
        notes.push(
          `does not list ${o.method} in Access-Control-Allow-Methods (${p3.allowMethods === null ? "missing" : `got "${p3.allowMethods}"`})`,
        );
      }
    }
    if (reasons.length) {
      out.push({
        ...c5,
        status: "fail",
        message: `The OPTIONS preflight ${notes.join("; ")}. Browsers will block the paid retry.`,
        fix: preflightFix(reasons, payHeaders),
        data: { reason: reasons[0], reasons, allowHeaders: allowH, status: p3.status },
      });
    } else {
      preflightOk = true;
      out.push({ ...c5, status: "pass", message: `Preflight allows ${payHeaders.join(" and ")}.` });
    }
    out.push({ ...c6, status: "pass", message: `The preflight is not charged (${p3.status}).` });
  }

  // ---- C7. cors.vary-origin ----
  if (acao === origin) {
    const vary = tokens(p2.vary);
    out.push(
      vary.includes("origin") || vary.includes("*")
        ? {
            id: "cors.vary-origin",
            category: B,
            status: "pass",
            title: "Vary: Origin when the origin is reflected",
            message: "Reflected origin, with Vary: Origin.",
          }
        : {
            id: "cors.vary-origin",
            category: B,
            status: "warn",
            title: "Vary: Origin when the origin is reflected",
            message: `Allow-Origin reflects the caller's origin but Vary ${p2.vary ? `is "${p2.vary}"` : "is missing"}. A CDN or shared cache can then serve a 402 built for another origin, or one built without CORS.`,
            fix: `Send \`Vary: Origin\` wherever you reflect the origin. The \`cors\` npm package does this automatically; hand-rolled reflection usually doesn't. Spec: ${refText(FIX_REFS.spec)}.`,
          },
    );
  }

  // ---- C8. cors.cache-control ----
  const p1c = cacheState(p1);
  const p2c = cacheState(p2);
  const cacheable = p1c.cacheable || p2c.cacheable;
  const hit = p1c.hit || p2c.hit;
  const cc = [p1.cacheControl, p2.cacheControl].find((x) => x) ?? null;
  out.push(
    !cacheable
      ? {
          id: "cors.cache-control",
          category: B,
          status: "pass",
          title: "The 402 is not publicly cacheable",
          message: cc ? `Cache-Control: ${cc}.` : "No Cache-Control on the 402 (402 is not heuristically cacheable).",
        }
      : {
          id: "cors.cache-control",
          category: B,
          status: hit ? "fail" : "warn",
          title: "The 402 is not publicly cacheable",
          message: hit
            ? `The 402 is publicly cacheable (Cache-Control: ${cc}) and was served from a shared cache (${[p1c.evidence, p2c.evidence].filter(Boolean).join("; ")}). A cached challenge goes stale and can be served without the CORS headers.`
            : `The 402 is publicly cacheable (Cache-Control: ${cc}). A shared cache can serve a stale challenge, or one built for another origin.`,
          fix: "Mark 402s `Cache-Control: no-store` (what @x402/core and the Go SDK send). A cached challenge goes stale and can be served without the CORS headers.",
          data: { cacheControl: cc, servedFromCache: hit },
        },
  );

  // ---- C9. cors.preflight-max-age (advisory) ----
  if (preflightOk && usable(p3)) {
    const age = p3.maxAge === null ? NaN : Number.parseInt(p3.maxAge, 10);
    out.push(
      Number.isFinite(age) && age >= 60
        ? {
            id: "cors.preflight-max-age",
            category: B,
            status: "pass",
            title: "Preflight is cached",
            message: `Access-Control-Max-Age: ${age}.`,
          }
        : {
            id: "cors.preflight-max-age",
            category: B,
            status: "warn",
            penalty: 0,
            title: "Preflight is cached",
            message: `Access-Control-Max-Age ${p3.maxAge === null ? "is missing" : `is ${p3.maxAge}`}: every cross-origin paid call pays an extra preflight round trip. Advisory, no score impact.`,
            fix: `Send \`Access-Control-Max-Age: 600\` (or more) on the preflight. Spec: ${refText(FIX_REFS.spec)}.`,
          },
    );
  }
  return out;
}

function preflightFix(reasons: string[], payHeaders: string[]): string {
  const parts: string[] = [];
  const r0 = reasons[0]!;
  if (r0.startsWith("non-2xx:")) {
    const st = Number(r0.slice(8));
    parts.push(
      st === 404 || st === 405
        ? `Register \`OPTIONS\` for paid routes, or mount CORS before the router (${refText(FIX_REFS.thread)}).`
        : `Answer \`OPTIONS\` on paid routes with 204 before any auth or payment middleware, with Access-Control-Allow-Headers including ${payHeaders.join(" and ")}.`,
    );
  }
  if (reasons.includes("no-acao")) parts.push("Send Access-Control-Allow-Origin on the preflight too.");
  if (reasons.includes("not-named") || reasons.includes("v1-only") || reasons.includes("wildcard-credentialed")) {
    parts.push(
      "Add `PAYMENT-SIGNATURE` to `Access-Control-Allow-Headers`, by name if any route uses cookies or `Authorization`; keep `X-PAYMENT` too while you serve v1 clients.",
    );
  }
  if (reasons.includes("content-type"))
    parts.push(`Add \`Content-Type\`; JSON bodies are not safelisted. Spec: ${refText(FIX_REFS.spec)}.`);
  if (reasons.includes("method")) parts.push("List the route's method in `Access-Control-Allow-Methods`.");
  return parts.join(" ");
}

function cacheState(r: ObservedResponse): { cacheable: boolean; hit: boolean; evidence?: string } {
  const dirs = new Map<string, string>();
  for (const t of tokens(r.cacheControl)) {
    const [k, v = ""] = t.split("=").map((s) => s.trim());
    dirs.set(k!, v.replace(/^"|"$/g, ""));
  }
  const num = (k: string) => (dirs.has(k) ? Number.parseInt(dirs.get(k)!, 10) : NaN);
  const safe = dirs.has("no-store") || dirs.has("private") || dirs.has("no-cache");
  const cacheable = !safe && (dirs.has("public") || num("s-maxage") > 0 || num("max-age") > 0);
  const age = r.age === null ? NaN : Number.parseInt(r.age, 10);
  const statusHit = /\bhit\b/i.test(r.cacheStatus ?? "");
  const hit = age > 0 || statusHit;
  const evidence = hit
    ? [age > 0 ? `Age: ${age}` : "", statusHit ? `cache status "${r.cacheStatus}"` : ""].filter(Boolean).join(", ")
    : undefined;
  return { cacheable, hit, evidence };
}
