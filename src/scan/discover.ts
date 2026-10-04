// Endpoint discovery for the public scan.
// Sources (all keyless, read-only):
//  - Coinbase CDP facilitator Bazaar: GET https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources
//  - PayAI facilitator Bazaar:        GET https://facilitator.payai.network/discovery/resources
// Not used: x402scan.com (its read API is itself x402-paid; x402-doctor never pays),
// x402.org/facilitator (testnet facilitator, no discovery endpoint).
import { DEFAULT_UA } from "../http.js";

/** One resource from a facilitator Bazaar /discovery/resources listing, normalized. */
export interface CatalogItem {
  source: string;
  resource: string;
  type: string;
  x402Version: number;
  /** HTTP method from the listing's bazaar/outputSchema metadata, upper-cased, when declared. */
  method?: string;
  accepts: Record<string, unknown>[];
  lastUpdated?: string;
}

/** The cached catalog file written by a scan (scan/cache/catalog-<date>.json). */
export interface ScanCatalog {
  fetchedAt: string;
  sources: Record<string, { total: number; fetched: number; complete?: boolean }>;
  items: CatalogItem[];
}

export const DISCOVERY_SOURCES = [
  { name: "cdp", url: "https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources" },
  { name: "payai", url: "https://facilitator.payai.network/discovery/resources" },
];

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
/** Follow a path of object keys, returning undefined at the first non-object. */
function dig(v: unknown, ...path: string[]): unknown {
  let cur = v;
  for (const k of path) {
    if (!isObj(cur)) return undefined;
    cur = cur[k];
  }
  return cur;
}

/** Listings declare the method in different places depending on the facilitator and Bazaar version. */
function methodOf(item: Json): string | undefined {
  const fromAccepts = Array.isArray(item.accepts) ? item.accepts.map((a) => dig(a, "outputSchema", "input", "method")).find((m) => typeof m === "string") : undefined;
  const m = dig(item, "extensions", "bazaar", "info", "input", "method") ?? fromAccepts ?? dig(item, "metadata", "input", "method");
  return typeof m === "string" ? m.toUpperCase() : undefined;
}

function toCatalogItem(source: string, it: Json): CatalogItem {
  return {
    source,
    resource: typeof it.resource === "string" ? it.resource : "",
    type: typeof it.type === "string" ? it.type : "http",
    x402Version: typeof it.x402Version === "number" ? it.x402Version : 0,
    method: methodOf(it),
    accepts: Array.isArray(it.accepts) ? it.accepts.filter(isObj) : [],
    lastUpdated: typeof it.lastUpdated === "string" ? it.lastUpdated : undefined,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Page through one Bazaar listing. Retries 429/5xx/network errors with backoff; if a page still can't
 * be read, stops and returns what it has with complete: false (the report shows listed vs fetched).
 */
export async function fetchCatalog(
  source: { name: string; url: string },
  opts: { pageSize?: number; delayMs?: number; log?: (s: string) => void; fetchImpl?: typeof fetch } = {},
): Promise<{ items: CatalogItem[]; total: number; complete: boolean }> {
  const f = opts.fetchImpl ?? fetch;
  const pageSize = opts.pageSize ?? 1000;
  const items: CatalogItem[] = [];
  let offset = 0;
  let total = Infinity;
  let complete = true;
  while (offset < total) {
    const url = `${source.url}?limit=${pageSize}&offset=${offset}`;
    let page: unknown;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const res = await f(url, { headers: { "user-agent": DEFAULT_UA, accept: "application/json" }, signal: AbortSignal.timeout(60000) });
        if (res.status === 429 || res.status >= 500) {
          await sleep(2000 * (attempt + 1));
          continue;
        }
        page = await res.json();
        break;
      } catch {
        await sleep(2000 * (attempt + 1));
      }
    }
    const pageItems = dig(page, "items");
    if (!Array.isArray(pageItems)) {
      opts.log?.(`  ${source.name}: stopped at offset ${offset} (page unreadable after retries)`);
      complete = false;
      break;
    }
    const declaredTotal = dig(page, "pagination", "total");
    total = typeof declaredTotal === "number" ? declaredTotal : items.length + pageItems.length;
    for (const it of pageItems) if (isObj(it)) items.push(toCatalogItem(source.name, it));
    opts.log?.(`  ${source.name}: ${items.length}/${total}`);
    if (pageItems.length === 0) break;
    offset += pageItems.length;
    await sleep(opts.delayMs ?? 750);
  }
  return { items, total: Number.isFinite(total) ? total : items.length, complete };
}

const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.0\.0\.0|\[?::1\]?)/;

export function isProbeableUrl(u: string): boolean {
  try {
    const url = new URL(u);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    if (PRIVATE_HOST.test(url.hostname)) return false;
    if (/^\d+\.\d+\.\d+\.\d+$/.test(url.hostname) && PRIVATE_HOST.test(url.hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

/** FNV-1a for stable, seedable sampling without crypto deps. */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export interface Selection {
  url: string;
  host: string;
  method: string;
  sources: string[];
  catalogVersion: number;
}

export function selectTargets(items: CatalogItem[], opts: { perHost: number; limit?: number }) {
  const byUrl = new Map<string, { item: CatalogItem; sources: Set<string> }>();
  for (const it of items) {
    if (it.type !== "http" || !isProbeableUrl(it.resource)) continue;
    const e = byUrl.get(it.resource);
    if (e) e.sources.add(it.source);
    else byUrl.set(it.resource, { item: it, sources: new Set([it.source]) });
  }
  const stats = { uniqueUrls: byUrl.size, hosts: new Set<string>(), methods: {} as Record<string, number>, nonGet: 0 };
  const byHost = new Map<string, Selection[]>();
  for (const [url, { item, sources }] of byUrl) {
    const host = new URL(url).host.toLowerCase();
    stats.hosts.add(host);
    const m = item.method ?? "UNKNOWN";
    stats.methods[m] = (stats.methods[m] ?? 0) + 1;
    // We only probe with GET/HEAD: skip routes the catalog says are POST/PUT/PATCH-only.
    if (item.method && !["GET", "HEAD", "DELETE"].includes(item.method)) {
      stats.nonGet++;
      continue;
    }
    if (item.method === "DELETE") continue;
    const sel: Selection = { url, host, method: "GET", sources: [...sources], catalogVersion: item.x402Version };
    const list = byHost.get(host) ?? [];
    list.push(sel);
    byHost.set(host, list);
  }
  let targets: Selection[] = [];
  for (const [, list] of byHost) {
    list.sort((a, b) => hash32(a.url) - hash32(b.url));
    targets.push(...list.slice(0, opts.perHost));
  }
  targets.sort((a, b) => hash32(a.host + a.url) - hash32(b.host + b.url));
  if (opts.limit) targets = targets.slice(0, opts.limit);
  return { targets, stats: { uniqueUrls: stats.uniqueUrls, hosts: stats.hosts.size, methods: stats.methods, nonGet: stats.nonGet, getHosts: byHost.size } };
}
