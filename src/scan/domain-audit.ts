import type { Check } from "../types.js";
import type { RpcClient } from "../rpc.js";
import { checkAsset } from "../checks/asset.js";
import { normalizeRequirement } from "../decode.js";
import { labelFor, namespaceOf, toCaip2 } from "../networks.js";
import type { CatalogItem } from "./discover.js";

/** One distinct declared EIP-712 domain in the catalogs and how it compares on-chain. */
export interface DomainAuditRow {
  network: string;
  networkLabel: string;
  asset: string;
  symbol?: string;
  declared: { name: string; version: string };
  verifyingContract?: string;
  status: Check["status"];
  expected?: { name?: string; version?: string };
  resources: number;
}

export type DomainAuditResult = Awaited<ReturnType<typeof catalogDomainAudit>>;

/**
 * Check every (network, asset, name, version, verifyingContract) tuple advertised in the discovery
 * catalogs, once each, against the chain. No endpoint is contacted. A resource counts as verified
 * when at least one of its options could be checked on-chain (pass or fail, not skip/unknown).
 */
export async function catalogDomainAudit(
  items: CatalogItem[],
  rpc: RpcClient,
): Promise<{ rows: DomainAuditRow[]; resourcesChecked: number; resourcesVerified: number; resourcesWithMismatch: number }> {
  const groups = new Map<string, { network: string; asset: string; name: string; version: string; verifyingContract?: string; urls: Set<string> }>();
  const checkedUrls = new Set<string>();
  for (const it of items) {
    for (const a of it.accepts) {
      const net = typeof a.network === "string" ? toCaip2(a.network) : undefined;
      if (namespaceOf(net) !== "eip155" || a.scheme !== "exact") continue;
      const extra = (a.extra ?? {}) as Record<string, unknown>;
      if ((extra.assetTransferMethod ?? "eip3009") !== "eip3009") continue;
      if (typeof extra.name !== "string" || typeof extra.version !== "string" || typeof a.asset !== "string") continue;
      const vc = typeof extra.verifyingContract === "string" ? extra.verifyingContract : undefined;
      const key = `${net}|${(a.asset).toLowerCase()}|${extra.name}|${extra.version}|${vc?.toLowerCase() ?? ""}`;
      const g = groups.get(key) ?? { network: net!, asset: a.asset, name: extra.name, version: extra.version, verifyingContract: vc, urls: new Set() };
      g.urls.add(it.resource);
      checkedUrls.add(it.resource);
      groups.set(key, g);
    }
  }
  const rows: DomainAuditRow[] = [];
  const mismatchUrls = new Set<string>();
  const verifiedUrls = new Set<string>();
  const list = [...groups.values()];
  for (let i = 0; i < list.length; i += 4) {
    await Promise.all(
      list.slice(i, i + 4).map(async (g) => {
        const req = normalizeRequirement({ scheme: "exact", network: g.network, asset: g.asset, amount: "1", payTo: "0x0000000000000000000000000000000000000001", maxTimeoutSeconds: 60, extra: { name: g.name, version: g.version, ...(g.verifyingContract ? { verifyingContract: g.verifyingContract } : {}) } }, 0, 2);
        const res = await checkAsset(req, rpc);
        const dc = res.checks.find((c) => c.id === "asset.eip712-domain") ?? res.checks.find((c) => c.id === "asset.exists" && c.status !== "pass");
        const status: Check["status"] = dc ? (dc.id === "asset.exists" && dc.status === "fail" ? "fail" : dc.status) : "skip";
        if (dc?.id === "asset.eip712-domain" && dc.status === "fail") g.urls.forEach((u) => mismatchUrls.add(u));
        if (dc?.id === "asset.eip712-domain" && (dc.status === "fail" || dc.status === "pass")) g.urls.forEach((u) => verifiedUrls.add(u));
        rows.push({
          network: g.network,
          networkLabel: labelFor(g.network),
          asset: g.asset,
          symbol: res.price?.symbol,
          declared: { name: g.name, version: g.version },
          verifyingContract: g.verifyingContract,
          status: dc?.id === "asset.exists" ? (dc.status === "fail" ? "fail" : dc.status) : status,
          expected: (dc?.data?.expected as DomainAuditRow["expected"]) ?? undefined,
          resources: g.urls.size,
        });
      }),
    );
  }
  rows.sort((a, b) => b.resources - a.resources);
  return { rows, resourcesChecked: checkedUrls.size, resourcesVerified: verifiedUrls.size, resourcesWithMismatch: mismatchUrls.size };
}
