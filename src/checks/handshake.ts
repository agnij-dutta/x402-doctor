import type { Challenge, Check } from "../types.js";
import type { ProbeResponse } from "../http.js";
import { buildChallenge, decodeHeaderValue, tryParseJson } from "../decode.js";

export interface HandshakeInput {
  url: string;
  method: string;
  primary: ProbeResponse;
  head?: ProbeResponse;
  corsGet?: ProbeResponse;
  preflight?: ProbeResponse;
  corsOrigin: string;
}

export interface HandshakeResult {
  checks: Check[];
  challenge?: Challenge;
  /** True when the outcome is inconclusive (network error, rate limit, WAF). */
  inconclusive: boolean;
}

const C = "handshake" as const;

function looksLikeWaf(r: ProbeResponse): boolean {
  const server = (r.headers.get("server") ?? "").toLowerCase();
  if (r.headers.get("cf-mitigated")) return true;
  if ((r.status === 403 || r.status === 503) && /cloudflare|akamai|sucuri|imperva/.test(server) && /<html/i.test(r.bodyText)) return true;
  if (/attention required|just a moment|captcha|access denied/i.test(r.bodyText.slice(0, 2000)) && /<html/i.test(r.bodyText)) return true;
  return false;
}

export function checkHandshake(inp: HandshakeInput): HandshakeResult {
  const checks: Check[] = [];
  const r = inp.primary;
  const M = inp.method;

  if (!r.ok) {
    checks.push({
      id: "handshake.reachable",
      category: C,
      status: "unknown",
      title: "Endpoint reachable",
      message: `${M} ${inp.url} failed: ${r.errorKind ?? "error"} (${r.error ?? ""})`.trim(),
      fix:
        r.errorKind === "tls"
          ? "Fix the TLS certificate; agents will refuse to pay an endpoint they can't verify."
          : "Check the URL and that the server is up.",
    });
    return { checks, inconclusive: true };
  }

  // ---- status code ----
  if (r.status === 429 || r.status === 502 || r.status === 503 || r.status === 504 || r.status === 500 || looksLikeWaf(r)) {
    checks.push({
      id: "handshake.status-402",
      category: C,
      status: "unknown",
      title: "Unpaid request returns 402",
      message: looksLikeWaf(r)
        ? `${M} returned ${r.status} from bot protection / WAF; could not see the 402.`
        : `${M} returned ${r.status} (rate limited or server error); inconclusive.`,
      fix: looksLikeWaf(r)
        ? "Exempt paid API routes from browser bot challenges: agents can't solve CAPTCHAs, so they never see your price."
        : "Retry later.",
      data: { status: r.status },
    });
    return { checks, inconclusive: true };
  }

  if (r.status !== 402) {
    const is2xx = r.status >= 200 && r.status < 300;
    checks.push({
      id: "handshake.status-402",
      category: C,
      status: "fail",
      critical: true,
      title: "Unpaid request returns 402",
      message: is2xx
        ? `${M} without payment returned ${r.status}: the resource is served for free (or the paywall is on a different method).`
        : `${M} without payment returned ${r.status}, not 402 Payment Required.`,
      fix:
        r.status === 404 || r.status === 405
          ? `The route may only accept another method. Re-run with --method POST, or make sure the x402 middleware is mounted for ${M}.`
          : r.status === 401 || r.status === 403
            ? "x402 clients only start the payment flow on HTTP 402. Return 402 (not 401/403) with the payment challenge for unpaid requests."
            : "Mount the x402 payment middleware on this route so unpaid requests get HTTP 402 with a PAYMENT-REQUIRED header.",
      data: { status: r.status },
    });
    return { checks, inconclusive: false };
  }
  // Hosting platforms answer 402 for their own billing reasons (Vercel: DEPLOYMENT_DISABLED).
  // That 402 is the platform's, not the app's x402 paywall.
  const platformErr =
    r.headers.get("x-vercel-error") ??
    (/^\s*Payment required\s+DEPLOYMENT_DISABLED/i.test(r.bodyText.slice(0, 200)) ? "DEPLOYMENT_DISABLED" : null);
  if (!r.headers.get("payment-required") && platformErr) {
    checks.push({
      id: "handshake.status-402",
      category: C,
      status: "fail",
      critical: true,
      title: "Unpaid request returns 402",
      message: `The 402 comes from the hosting platform (Vercel ${platformErr}), not from x402: the deployment is disabled, so nothing behind it can be paid for.`,
      fix: "Re-enable the deployment (check the Vercel project's billing/usage), or remove the endpoint from discovery catalogs.",
      data: { status: 402, platform: `vercel:${platformErr}` },
    });
    return { checks, inconclusive: false };
  }
  checks.push({
    id: "handshake.status-402",
    category: C,
    status: "pass",
    title: "Unpaid request returns 402",
    message: `${M} returned 402 Payment Required in ${r.ms} ms.`,
  });

  // ---- challenge location / encoding ----
  const header = r.headers.get("payment-required");
  const body = tryParseJson(r.bodyText);
  let challenge: Challenge | undefined;

  if (header) {
    const d = decodeHeaderValue(header);
    if (!d.ok) {
      checks.push({
        id: "handshake.challenge-decode",
        category: C,
        status: "fail",
        critical: true,
        title: "PAYMENT-REQUIRED header decodes",
        message: `PAYMENT-REQUIRED header present but ${d.error}.`,
        fix: "Set PAYMENT-REQUIRED to standard base64 (with padding) of the UTF-8 JSON PaymentRequired object. Use encodePaymentRequiredHeader() from @x402/core/http.",
      });
    } else if (d.encoding === "base64url") {
      checks.push({
        id: "handshake.challenge-decode",
        category: C,
        status: "fail",
        critical: true,
        title: "PAYMENT-REQUIRED header decodes",
        message:
          "PAYMENT-REQUIRED is base64url. The reference client (@x402/core) validates against the standard base64 alphabet and rejects '-' and '_'.",
        fix: "Encode with standard base64 (+ and /, with = padding), e.g. Buffer.from(json).toString('base64').",
      });
      challenge = buildChallenge(d.json, "header");
    } else {
      challenge = buildChallenge(d.json, "header");
      checks.push({
        id: "handshake.challenge-decode",
        category: C,
        status: "pass",
        title: "PAYMENT-REQUIRED header decodes",
        message: `v2 challenge found in PAYMENT-REQUIRED header (${header.length} chars).`,
      });
    }
    if (challenge && challenge.version !== 2) {
      checks.push({
        id: "handshake.version",
        category: C,
        status: "fail",
        critical: challenge.version !== 1,
        title: "Protocol version is consistent",
        message: `PAYMENT-REQUIRED header carries x402Version ${JSON.stringify(challenge.raw.x402Version)}; the header transport is v2 only.`,
        fix: "Either emit a full v2 PaymentRequired (x402Version: 2, CAIP-2 networks, `amount`) in the header, or drop the header and serve the v1 JSON body.",
      });
    }
    if (body && typeof body.x402Version === "number" && challenge && body.x402Version !== challenge.version) {
      checks.push({
        id: "handshake.version",
        category: C,
        status: "warn",
        title: "Protocol version is consistent",
        message: `Header says x402Version ${challenge.version} but the JSON body says ${body.x402Version}. Clients prefer the header; body-reading clients will see a different protocol.`,
        fix: "Serve one version. If you need both, make sure each is internally complete and describes the same price.",
      });
    } else if (challenge && challenge.version === 2) {
      checks.push({ id: "handshake.version", category: C, status: "pass", title: "Protocol version is consistent", message: "x402 v2." });
    }
  } else if (body && body.x402Version === 1) {
    challenge = buildChallenge(body, "body");
    checks.push({
      id: "handshake.challenge-decode",
      category: C,
      status: "pass",
      title: "Payment challenge present",
      message: "v1 challenge found in JSON body (x402Version: 1).",
    });
    checks.push({
      id: "handshake.version",
      category: C,
      status: "warn",
      title: "Protocol version is current",
      message:
        "Endpoint speaks x402 v1 (legacy). v2 clients still accept it, but v2 adds CAIP-2 networks, extensions and the header transport.",
      fix: "Upgrade to @x402/* v2 middleware; it emits PAYMENT-REQUIRED and keeps v1 clients working.",
    });
  } else if (body && body.x402Version === 2) {
    challenge = buildChallenge(body, "body");
    checks.push({
      id: "handshake.challenge-decode",
      category: C,
      status: "fail",
      critical: true,
      title: "Payment challenge present",
      message:
        "v2 challenge is only in the JSON body. Reference clients look for v2 in the PAYMENT-REQUIRED header and only read the body for x402Version 1, so they throw 'Invalid payment required response'.",
      fix: "Send the same object base64-encoded in a PAYMENT-REQUIRED response header.",
    });
  } else if (body && Array.isArray(body.accepts)) {
    challenge = buildChallenge(body, "body");
    checks.push({
      id: "handshake.challenge-decode",
      category: C,
      status: "fail",
      critical: true,
      title: "Payment challenge present",
      message: `JSON body has accepts[] but x402Version is ${JSON.stringify(body.x402Version)}; clients can't tell which protocol to speak.`,
      fix: "Set x402Version to 1 (body transport) or move to v2 with a PAYMENT-REQUIRED header.",
    });
  } else {
    const www = r.headers.get("www-authenticate") ?? "";
    const isMpp = /^\s*Payment\b/i.test(www);
    checks.push({
      id: "handshake.challenge-decode",
      category: C,
      status: "fail",
      critical: true,
      title: "Payment challenge present",
      message: isMpp
        ? "402 carries a WWW-Authenticate: Payment challenge (MPP), not an x402 challenge."
        : "402 response has no PAYMENT-REQUIRED header and no x402 JSON body.",
      fix: isMpp
        ? "This endpoint speaks MPP. If you also want x402 agents, add a PAYMENT-REQUIRED header alongside it."
        : "Return the PaymentRequired object (base64) in a PAYMENT-REQUIRED header. Check that a proxy or CDN isn't stripping custom headers from 402 responses.",
      data: { mpp: isMpp },
    });
  }

  // ---- HEAD ----
  if (inp.head) {
    const h = inp.head;
    if (!h.ok || h.status === 429 || h.status >= 500) {
      checks.push({ id: "handshake.head", category: C, status: "skip", title: "HEAD is also gated", message: "HEAD probe inconclusive." });
    } else if (h.status === 402) {
      checks.push({ id: "handshake.head", category: C, status: "pass", title: "HEAD is also gated", message: "HEAD returns 402 too." });
    } else if (h.status >= 200 && h.status < 300 && M === "GET") {
      checks.push({
        id: "handshake.head",
        category: C,
        status: "warn",
        title: "HEAD is also gated",
        message: `HEAD returned ${h.status} without payment while GET returns 402. Many frameworks answer HEAD by running the GET handler, so your paid handler may be executing for free (body discarded).`,
        fix: "Gate HEAD with the same middleware as GET, or reject HEAD on paid routes with 405.",
        data: { status: h.status },
      });
    } else {
      checks.push({
        id: "handshake.head",
        category: C,
        status: "pass",
        title: "HEAD is also gated",
        message: `HEAD returns ${h.status} (not served unpaid).`,
      });
    }
  }

  // ---- CORS ----
  checks.push(...corsChecks(inp, challenge?.version ?? (header ? 2 : 1)));

  // ---- latency ----
  const ms = r.ms;
  checks.push({
    id: "handshake.latency",
    category: C,
    status: ms <= 1000 ? "pass" : "warn",
    title: "402 response time",
    message: `${ms} ms to produce the 402 challenge.`,
    fix:
      ms > 1000
        ? "The 402 should be cheap: build requirements statically, don't call the facilitator or chain before answering an unpaid request."
        : undefined,
    data: { ms },
  });

  return { checks, challenge, inconclusive: false };
}

function listHas(list: string | null, name: string): boolean {
  if (!list) return false;
  return list
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .some((s) => s === "*" || s === name.toLowerCase());
}

function corsChecks(inp: HandshakeInput, version: number): Check[] {
  const out: Check[] = [];
  const g = inp.corsGet;
  if (!g || !g.ok || g.status === 429 || g.status >= 500) {
    out.push({
      id: "handshake.cors-expose",
      category: C,
      status: "skip",
      title: "CORS exposes x402 headers",
      message: "CORS probe inconclusive.",
    });
    return out;
  }
  const acao = g.headers.get("access-control-allow-origin");
  const acac = (g.headers.get("access-control-allow-credentials") ?? "").toLowerCase() === "true";
  const expose = g.headers.get("access-control-expose-headers");
  if (!acao) {
    out.push({
      id: "handshake.cors-expose",
      category: C,
      status: "warn",
      title: "CORS exposes x402 headers",
      message:
        "No Access-Control-Allow-Origin on the 402: browser wallets and in-page agents can't call this endpoint. Fine if it is server-to-server only.",
      fix: `Add CORS for paid routes: Access-Control-Allow-Origin, and Access-Control-Expose-Headers: ${version === 2 ? "PAYMENT-REQUIRED, PAYMENT-RESPONSE" : "X-PAYMENT-RESPONSE"}.`,
      data: { cors: "none" },
    });
    return out;
  }
  // "*" in expose-headers is ignored by browsers when credentials are allowed.
  const has = (n: string) => listHas(expose, n) && !(acac && (expose ?? "").trim() === "*");
  if (version === 2) {
    const missing: string[] = [];
    if (!has("PAYMENT-REQUIRED")) missing.push("PAYMENT-REQUIRED");
    if (!has("PAYMENT-RESPONSE")) missing.push("PAYMENT-RESPONSE");
    if (missing.includes("PAYMENT-REQUIRED")) {
      out.push({
        id: "handshake.cors-expose",
        category: C,
        status: "fail",
        title: "CORS exposes x402 headers",
        message: `CORS is enabled (Allow-Origin: ${acao}) but Access-Control-Expose-Headers ${expose ? `is "${expose}"` : "is missing"}. Browsers hide PAYMENT-REQUIRED from fetch(), so browser clients see a 402 with no price and can't pay.`,
        fix: "Add `Access-Control-Expose-Headers: PAYMENT-REQUIRED, PAYMENT-RESPONSE` to every response on paid routes (including the 402).",
        data: { cors: "no-expose", acao, expose },
      });
    } else if (missing.length) {
      out.push({
        id: "handshake.cors-expose",
        category: C,
        status: "warn",
        title: "CORS exposes x402 headers",
        message: `PAYMENT-REQUIRED is exposed but ${missing.join(", ")} is not (on the 402 at least). Browser clients won't see the settlement receipt after paying.`,
        fix: "Expose PAYMENT-RESPONSE too: `Access-Control-Expose-Headers: PAYMENT-REQUIRED, PAYMENT-RESPONSE`.",
        data: { cors: "partial", acao, expose },
      });
    } else {
      out.push({
        id: "handshake.cors-expose",
        category: C,
        status: "pass",
        title: "CORS exposes x402 headers",
        message: `Exposes ${expose}.`,
        data: { cors: "ok" },
      });
    }
  } else {
    if (!has("X-PAYMENT-RESPONSE")) {
      out.push({
        id: "handshake.cors-expose",
        category: C,
        status: "warn",
        title: "CORS exposes x402 headers",
        message:
          "v1 challenge is in the body (readable), but X-PAYMENT-RESPONSE isn't exposed, so browser clients can't read the settlement receipt.",
        fix: "Add `Access-Control-Expose-Headers: X-PAYMENT-RESPONSE`.",
        data: { cors: "partial", acao, expose },
      });
    } else {
      out.push({
        id: "handshake.cors-expose",
        category: C,
        status: "pass",
        title: "CORS exposes x402 headers",
        message: `Exposes ${expose}.`,
        data: { cors: "ok" },
      });
    }
  }

  // preflight: can the browser send the payment header?
  const p = inp.preflight;
  const payHeader = version === 2 ? "PAYMENT-SIGNATURE" : "X-PAYMENT";
  if (p && p.ok && p.status < 500 && p.status !== 429) {
    const allowH = p.headers.get("access-control-allow-headers");
    const allowO = p.headers.get("access-control-allow-origin");
    // Fetch standard, CORS-preflight fetch: the response must have an "ok status" (200-299). A paywall
    // that also answers OPTIONS with 402 (or a router that 404s it) blocks the paid retry whatever its headers say.
    if (p.status < 200 || p.status > 299) {
      out.push({
        id: "handshake.cors-preflight",
        category: C,
        status: "fail",
        title: "CORS preflight allows the payment header",
        message: `OPTIONS preflight returned ${p.status}. Browsers require a 2xx preflight, so they will block the paid retry even though the headers may be right.`,
        fix: `Answer OPTIONS on paid routes with 204 (before the payment middleware) and Access-Control-Allow-Headers including ${payHeader}.`,
        data: { allowHeaders: allowH, status: p.status },
      });
    } else if (!allowO || !listHas(allowH, payHeader)) {
      out.push({
        id: "handshake.cors-preflight",
        category: C,
        status: "fail",
        title: "CORS preflight allows the payment header",
        message: `OPTIONS preflight ${allowO ? "" : "has no Allow-Origin and "}does not list ${payHeader} in Access-Control-Allow-Headers (got "${allowH ?? ""}"). Browsers will block the paid retry.`,
        fix: `Answer OPTIONS on paid routes with Access-Control-Allow-Headers including ${payHeader} (and Content-Type).`,
        data: { allowHeaders: allowH, status: p.status },
      });
    } else {
      out.push({
        id: "handshake.cors-preflight",
        category: C,
        status: "pass",
        title: "CORS preflight allows the payment header",
        message: `Preflight allows ${payHeader}.`,
      });
    }
  }
  return out;
}
