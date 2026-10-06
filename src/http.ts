export const VERSION = "0.1.1";
export const DEFAULT_UA = `x402-doctor/${VERSION} (+https://github.com/agnij-dutta/x402-doctor)`;

/** Headers that would carry a payment. x402-doctor must never send them. */
const FORBIDDEN = ["payment-signature", "x-payment", "authorization"];

export interface ProbeResponse {
  ok: boolean;
  status: number;
  headers: Headers;
  bodyText: string;
  ms: number;
  error?: string;
  /** network-level failure kind, when no HTTP response was received */
  errorKind?: "timeout" | "dns" | "tls" | "refused" | "network";
}

export interface RequestOpts {
  method: string;
  headers?: Record<string, string>;
  timeoutMs: number;
  userAgent: string;
  fetchImpl: typeof fetch;
  maxBodyBytes?: number;
}

function classify(err: unknown): ProbeResponse["errorKind"] {
  const e = err as { name?: string; cause?: { code?: string }; message?: string };
  if (e?.name === "TimeoutError" || e?.name === "AbortError") return "timeout";
  const code = e?.cause?.code ?? "";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "dns";
  if (code === "ECONNREFUSED" || code === "ECONNRESET") return "refused";
  if (/CERT|SSL|TLS/i.test(code) || /certificate/i.test(e?.message ?? "")) return "tls";
  return "network";
}

export async function request(url: string, o: RequestOpts): Promise<ProbeResponse> {
  const headers: Record<string, string> = { "user-agent": o.userAgent, accept: "application/json, */*;q=0.5", ...(o.headers ?? {}) };
  for (const k of Object.keys(headers)) {
    if (FORBIDDEN.includes(k.toLowerCase())) {
      throw new Error(`x402-doctor refuses to send payment/credential header ${k}`);
    }
  }
  const t0 = performance.now();
  try {
    const res = await o.fetchImpl(url, {
      method: o.method,
      headers,
      redirect: "follow",
      signal: AbortSignal.timeout(o.timeoutMs),
    });
    let bodyText = "";
    if (o.method !== "HEAD" && o.method !== "OPTIONS") {
      bodyText = await readCapped(res, o.maxBodyBytes ?? 256 * 1024);
    } else {
      await res.body?.cancel().catch(() => {});
    }
    return { ok: true, status: res.status, headers: res.headers, bodyText, ms: Math.round(performance.now() - t0) };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      headers: new Headers(),
      bodyText: "",
      ms: Math.round(performance.now() - t0),
      error: (err as Error)?.message ?? String(err),
      errorKind: classify(err),
    };
  }
}

async function readCapped(res: Response, cap: number): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
    if (total >= cap) {
      await reader.cancel().catch(() => {});
      break;
    }
  }
  return Buffer.concat(chunks).toString("utf8");
}
