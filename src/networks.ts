// Network tables. Sources: x402-foundation/x402 mechanisms/evm/src/constants.ts (EVM_NETWORK_CHAIN_ID_MAP),
// mechanisms/svm/src/constants.ts (V1_TO_V2_NETWORK_MAP), mechanisms/evm/src/defaultAssets.ts.

export const SOLANA_MAINNET = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
export const SOLANA_DEVNET = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
export const SOLANA_TESTNET = "solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z";

/** v1 network names (legacy) -> CAIP-2. */
export const V1_NETWORKS: Record<string, string> = {
  ethereum: "eip155:1",
  sepolia: "eip155:11155111",
  abstract: "eip155:2741",
  "abstract-testnet": "eip155:11124",
  "base-sepolia": "eip155:84532",
  base: "eip155:8453",
  "avalanche-fuji": "eip155:43113",
  avalanche: "eip155:43114",
  iotex: "eip155:4689",
  sei: "eip155:1329",
  "sei-testnet": "eip155:1328",
  polygon: "eip155:137",
  "polygon-amoy": "eip155:80002",
  peaq: "eip155:3338",
  story: "eip155:1514",
  educhain: "eip155:41923",
  "skale-base-sepolia": "eip155:324705682",
  megaeth: "eip155:4326",
  monad: "eip155:143",
  "monad-testnet": "eip155:10143",
  stable: "eip155:988",
  "stable-testnet": "eip155:2201",
  celo: "eip155:42220",
  flare: "eip155:14",
  xlayer: "eip155:196",
  "xlayer-testnet": "eip155:1952",
  arbitrum: "eip155:42161",
  "arbitrum-sepolia": "eip155:421614",
  optimism: "eip155:10",
  "optimism-sepolia": "eip155:11155420",
  solana: SOLANA_MAINNET,
  "solana-devnet": SOLANA_DEVNET,
  "solana-testnet": SOLANA_TESTNET,
};

export const CAIP2_REGEX = /^[-a-z0-9]{3,8}:[-_a-zA-Z0-9]{1,32}$/;

export const NETWORK_LABELS: Record<string, string> = {
  "eip155:1": "Ethereum",
  "eip155:11155111": "Sepolia",
  "eip155:8453": "Base",
  "eip155:84532": "Base Sepolia",
  "eip155:43114": "Avalanche",
  "eip155:43113": "Avalanche Fuji",
  "eip155:137": "Polygon",
  "eip155:80002": "Polygon Amoy",
  "eip155:42161": "Arbitrum",
  "eip155:421614": "Arbitrum Sepolia",
  "eip155:10": "OP Mainnet",
  "eip155:11155420": "OP Sepolia",
  "eip155:1329": "Sei",
  "eip155:1328": "Sei Testnet",
  "eip155:196": "X Layer",
  "eip155:1952": "X Layer Testnet",
  "eip155:143": "Monad",
  "eip155:10143": "Monad Testnet",
  "eip155:4689": "IoTeX",
  "eip155:2741": "Abstract",
  "eip155:1514": "Story",
  "eip155:988": "Stable",
  "eip155:4326": "MegaETH",
  "eip155:42220": "Celo",
  "eip155:14": "Flare",
  "eip155:3338": "peaq",
  [SOLANA_MAINNET]: "Solana",
  [SOLANA_DEVNET]: "Solana Devnet",
  [SOLANA_TESTNET]: "Solana Testnet",
};

/**
 * Keyless public RPCs. Override with --rpc, or X402_DOCTOR_RPC_<chainId> for EVM and
 * X402_DOCTOR_RPC_<CAIP-2 upper-cased, non-alphanumerics as "_"> otherwise (see rpcsFor).
 */
export const DEFAULT_RPCS: Record<string, string[]> = {
  "eip155:1": ["https://ethereum-rpc.publicnode.com", "https://eth.llamarpc.com"],
  "eip155:11155111": ["https://ethereum-sepolia-rpc.publicnode.com", "https://rpc.sepolia.org"],
  "eip155:8453": ["https://mainnet.base.org", "https://base-rpc.publicnode.com"],
  "eip155:84532": ["https://sepolia.base.org", "https://base-sepolia-rpc.publicnode.com"],
  "eip155:43114": ["https://api.avax.network/ext/bc/C/rpc", "https://avalanche-c-chain-rpc.publicnode.com"],
  "eip155:43113": ["https://api.avax-test.network/ext/bc/C/rpc", "https://avalanche-fuji-c-chain-rpc.publicnode.com"],
  "eip155:137": ["https://polygon-bor-rpc.publicnode.com", "https://polygon-rpc.com"],
  "eip155:80002": ["https://rpc-amoy.polygon.technology", "https://polygon-amoy-bor-rpc.publicnode.com"],
  "eip155:42161": ["https://arb1.arbitrum.io/rpc", "https://arbitrum-one-rpc.publicnode.com"],
  "eip155:421614": ["https://sepolia-rollup.arbitrum.io/rpc", "https://arbitrum-sepolia-rpc.publicnode.com"],
  "eip155:10": ["https://mainnet.optimism.io", "https://optimism-rpc.publicnode.com"],
  "eip155:11155420": ["https://sepolia.optimism.io", "https://optimism-sepolia-rpc.publicnode.com"],
  "eip155:1329": ["https://evm-rpc.sei-apis.com", "https://sei-evm-rpc.publicnode.com"],
  "eip155:1328": ["https://evm-rpc-testnet.sei-apis.com"],
  "eip155:196": ["https://rpc.xlayer.tech", "https://xlayerrpc.okx.com"],
  "eip155:1952": ["https://testrpc.xlayer.tech"],
  "eip155:143": ["https://rpc.monad.xyz"],
  "eip155:10143": ["https://testnet-rpc.monad.xyz"],
  "eip155:4689": ["https://babel-api.mainnet.iotex.io"],
  "eip155:2741": ["https://api.mainnet.abs.xyz"],
  "eip155:1514": ["https://mainnet.storyrpc.io"],
  "eip155:988": ["https://rpc.stable.xyz"],
  "eip155:42220": ["https://forno.celo.org"],
  "eip155:14": ["https://flare-api.flare.network/ext/C/rpc"],
  [SOLANA_MAINNET]: ["https://api.mainnet-beta.solana.com"],
  [SOLANA_DEVNET]: ["https://api.devnet.solana.com"],
  [SOLANA_TESTNET]: ["https://api.testnet.solana.com"],
};

/** Assets we can price in USD (stablecoins). Keyed by lowercase address / mint. */
export const USD_STABLECOINS: Record<string, string> = {
  // USDC
  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": "USDC",
  "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238": "USDC",
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": "USDC",
  "0x036cbd53842c5426634e7929541ec2318f3dcf7e": "USDC",
  "0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e": "USDC",
  "0x5425890298aed601595a70ab815c96711a31bc65": "USDC",
  "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359": "USDC",
  "0x41e94eb019c0762f9bfcf9fb1e58725bfb0e7582": "USDC",
  "0xaf88d065e77c8cc2239327c5edb3a432268e5831": "USDC",
  "0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d": "USDC",
  "0x0b2c639c533813f4aa9d7837caf62653d097ff85": "USDC",
  "0x5fd84259d66cd46123540766be93dfe6d43130d7": "USDC",
  "0x754704bc059f8c67012fed69bc8a327a5aafb603": "USDC",
  "0x534b2f3a21130d7a60830c2df862319e593943a3": "USDC",
  // USDT0 / MegaUSD / mUSD / SBC (from defaultAssets.ts)
  "0x779ded0c9e1022225f8e0630b35a9b54be713736": "USDT0",
  "0x78cf24370174180738c5b8e352b6d14c83a6c9a9": "USDT0",
  "0xfafddbb3fc7688494971a79cc65dca3ef82079e7": "MegaUSD",
  "0xdd468a1ddc392dcdbef6db6e34e89aa338f9f186": "mUSD",
  "0x33ad9e4bd16b69b5bfded37d8b5d9ff9aba014fb": "SBC",
  // Solana
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: "USDC",
  "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU": "USDC",
};

export const PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
export const X402_EXACT_PERMIT2_PROXY = "0x402085c248EeA27D92E8b30b2C58ed07f9E20001";
export const X402_UPTO_PERMIT2_PROXY = "0x4020A4f3b7b90ccA423B9fabCc0CE57C6C240002";

export const SPL_TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const SPL_TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

export const KNOWN_SCHEMES = ["exact", "upto", "batch-settlement", "auth-capture"];

/** Public facilitators whose /supported is keyless. */
export const PUBLIC_FACILITATORS = ["https://x402.org/facilitator", "https://facilitator.payai.network"];

export function toCaip2(network: string): string | undefined {
  if (CAIP2_REGEX.test(network)) return network;
  return V1_NETWORKS[network];
}

export function namespaceOf(caip2: string | undefined): string | undefined {
  return caip2?.split(":")[0];
}

export function chainIdOf(caip2: string): number | undefined {
  const [ns, ref] = caip2.split(":");
  if (ns !== "eip155") return undefined;
  const n = Number(ref);
  return Number.isInteger(n) ? n : undefined;
}

export function labelFor(caip2: string | undefined, fallback?: string): string {
  if (!caip2) return fallback ?? "unknown";
  return NETWORK_LABELS[caip2] ?? caip2;
}

export function isTestnet(caip2: string | undefined): boolean {
  if (!caip2) return false;
  const l = labelFor(caip2).toLowerCase();
  return /sepolia|fuji|amoy|devnet|testnet/.test(l);
}

export function rpcsFor(caip2: string, overrides?: Record<string, string | string[]>): string[] {
  const o = overrides?.[caip2];
  if (o) return Array.isArray(o) ? o : [o];
  const envKey = "X402_DOCTOR_RPC_" + (chainIdOf(caip2)?.toString() ?? caip2.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase());
  const env = process.env[envKey];
  if (env) return env.split(",");
  return DEFAULT_RPCS[caip2] ?? [];
}
