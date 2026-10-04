import type { NormalizedRequirement, PriceInfo } from "../types.js";
import { USD_STABLECOINS } from "../networks.js";
import { USD_SYMBOL } from "../knownAssets.js";

/** Format an atomic-unit integer string with `decimals` places, trimming trailing zeros. */
export function formatUnits(atomic: string, decimals: number): string {
  const n = BigInt(atomic);
  const base = 10n ** BigInt(decimals);
  const whole = n / base;
  const frac = (n % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

function usdString(amount: number): string {
  if (amount === 0) return "$0";
  if (amount < 0.01) return "$" + amount.toPrecision(2).replace(/0+$/, "");
  return "$" + amount.toFixed(amount < 1 ? 4 : 2).replace(/(\.\d\d)0+$/, "$1");
}

/** Build the human price for an option. USD is only claimed for known stablecoins or USD-like symbols. */
export function makePrice(a: NormalizedRequirement, decimals?: number, symbol?: string): PriceInfo | undefined {
  if (typeof a.amount !== "string" || !/^\d+$/.test(a.amount)) return undefined;
  const p: PriceInfo = {
    accept: a.index,
    atomic: a.amount,
    decimals,
    symbol,
    network: a.caip2,
    asset: typeof a.asset === "string" ? a.asset : undefined,
  };
  if (decimals !== undefined) {
    const units = formatUnits(a.amount, decimals);
    const assetKey = typeof a.asset === "string" ? (a.asset.startsWith("0x") ? a.asset.toLowerCase() : a.asset) : "";
    const isUsd = !!USD_STABLECOINS[assetKey] || (!!symbol && USD_SYMBOL.test(symbol));
    if (isUsd) {
      p.usd = Number(units);
      p.human = usdString(p.usd);
    } else {
      p.human = `${units} ${symbol ?? "units"}`;
    }
  }
  return p;
}
