// Verified token EIP-712 domains. USDC rows verified on-chain 2026-10-04 (see paydecode SPEC-NOTES);
// non-USDC rows from x402-foundation/x402 mechanisms/evm/src/defaultAssets.ts.
export interface KnownAsset {
  network: string;
  address: string;
  name: string;
  version: string;
  decimals: number;
  symbol: string;
  transfer?: "permit2";
}

export const KNOWN_ASSETS: KnownAsset[] = [
  {
    network: "eip155:1",
    address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    name: "USD Coin",
    version: "2",
    decimals: 6,
    symbol: "USDC",
  },
  {
    network: "eip155:11155111",
    address: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    name: "USDC",
    version: "2",
    decimals: 6,
    symbol: "USDC",
  },
  {
    network: "eip155:8453",
    address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    name: "USD Coin",
    version: "2",
    decimals: 6,
    symbol: "USDC",
  },
  {
    network: "eip155:84532",
    address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    name: "USDC",
    version: "2",
    decimals: 6,
    symbol: "USDC",
  },
  {
    network: "eip155:43114",
    address: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
    name: "USD Coin",
    version: "2",
    decimals: 6,
    symbol: "USDC",
  },
  {
    network: "eip155:43113",
    address: "0x5425890298aed601595a70AB815c96711a31Bc65",
    name: "USD Coin",
    version: "2",
    decimals: 6,
    symbol: "USDC",
  },
  {
    network: "eip155:137",
    address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
    name: "USD Coin",
    version: "2",
    decimals: 6,
    symbol: "USDC",
  },
  {
    network: "eip155:80002",
    address: "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582",
    name: "USDC",
    version: "2",
    decimals: 6,
    symbol: "USDC",
  },
  {
    network: "eip155:42161",
    address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    name: "USD Coin",
    version: "2",
    decimals: 6,
    symbol: "USDC",
  },
  {
    network: "eip155:421614",
    address: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
    name: "USD Coin",
    version: "2",
    decimals: 6,
    symbol: "USDC",
  },
  {
    network: "eip155:10",
    address: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
    name: "USD Coin",
    version: "2",
    decimals: 6,
    symbol: "USDC",
  },
  {
    network: "eip155:11155420",
    address: "0x5fd84259d66Cd46123540766Be93DFE6D43130D7",
    name: "USDC",
    version: "2",
    decimals: 6,
    symbol: "USDC",
  },
  { network: "eip155:143", address: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603", name: "USDC", version: "2", decimals: 6, symbol: "USDC" },
  {
    network: "eip155:10143",
    address: "0x534b2f3A21130d7a60830c2Df862319e593943A3",
    name: "USDC",
    version: "2",
    decimals: 6,
    symbol: "USDC",
  },
  {
    network: "eip155:988",
    address: "0x779Ded0c9e1022225f8E0630b35a9b54bE713736",
    name: "USDT0",
    version: "1",
    decimals: 6,
    symbol: "USDT0",
  },
  {
    network: "eip155:4326",
    address: "0xFAfDdbb3FC7688494971a79cc65DCa3EF82079E7",
    name: "MegaUSD",
    version: "1",
    decimals: 18,
    symbol: "MegaUSD",
    transfer: "permit2",
  },
];

export function findKnownAsset(address: string): KnownAsset[] {
  const a = address.toLowerCase();
  return KNOWN_ASSETS.filter((k) => k.address.toLowerCase() === a);
}

export const USD_SYMBOL = /^(USDC|USDC\.e|USDbC|USDT|USDT0|USD₮0|DAI|PYUSD|USDS|USDG|FDUSD|MegaUSD|mUSD|SBC|USD Coin|Bridged USDC)$/i;
