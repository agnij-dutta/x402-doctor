# x402-doctor public scan, 2026-10-04

Probed **1696** public x402 endpoints across **1696** hosts, discovered from the facilitator Bazaar catalogs (cdp: 29,326 listed, payai: 12,528 listed). No payment was signed or sent.

## Headline

- **1359** endpoints answered an unpaid GET with HTTP 402 and a readable x402 challenge (1359 hosts). Another 1 answered 402 with no x402 challenge at all.
- **2.4%** of them (33) advertise at least one payment option that cannot settle as advertised (a confirmed, settlement-blocking failure).
- **1.3%** (17) have **no** working payment option at all.
- **81.9%** (1113) have no confirmed failures.
- Most common failure: **CORS on, but PAYMENT-REQUIRED not exposed to browsers**, 192 endpoints (14.1% of live). It breaks browser clients only; server-side agents can still pay.
- Most common settlement-blocking failure: **Network id in the wrong format**, 12 endpoints (0.9% of live).
- Median price: **$0.01** per request (p25 $0.0050, p75 $0.03, n=1358).

## Outcomes of the unpaid probe

| outcome | endpoints | meaning |
|---|---:|---|
| x402-ok | 1113 | 402 with a valid challenge, no confirmed failures |
| x402-issues | 213 | 402, confirmed failures that don't block settlement (e.g. CORS) |
| gone | 128 | 404/410: listed in the catalog but gone |
| other-status | 48 | other status |
| served-free | 45 | 2xx without payment (paywall missing on GET) |
| method | 38 | 405: GET not allowed |
| x402-broken | 33 | 402, at least one option can't settle |
| auth | 26 | 401/403 instead of 402 |
| host-disabled | 24 | 402 from the hosting platform (deployment disabled), not x402 |
| inconclusive | 15 | 429/5xx/WAF; not counted as failure |
| unreachable | 12 | DNS/TLS/timeout/connection error |
| 402-no-x402 | 1 | 402 but no readable x402 challenge |

## Failure modes (confirmed on a second serial probe), among live 402 endpoints

| # | failure | endpoints | % of live | hosts | blocks settlement |
|---:|---|---:|---:|---:|:---:|
| 1 | CORS on, but PAYMENT-REQUIRED not exposed to browsers (`handshake.cors-expose`) | 192 | 14.1% | 192 | no |
| 2 | CORS preflight blocks the payment header (`handshake.cors-preflight`) | 132 | 9.7% | 132 | no |
| 3 | Network id in the wrong format (`schema.network`) | 12 | 0.9% | 12 | yes |
| 4 | Solana extra.feePayer missing (`schema.svm-feepayer`) | 11 | 0.8% | 11 | yes |
| 5 | extra.name / extra.version missing (`schema.eip712-extra`) | 6 | 0.4% | 6 | yes |
| 6 | resource.url missing (`schema.resource`) | 4 | 0.3% | 4 | no |
| 7 | EIP-712 domain (extra.name/version) doesn't match the token (`asset.eip712-domain`) | 3 | 0.2% | 3 | yes |
| 8 | Protocol version inconsistent (`handshake.version`) | 3 | 0.2% | 3 | no |
| 9 | Asset contract/mint not on the declared network (`asset.exists`) | 2 | 0.1% | 2 | yes |
| 10 | payTo invalid (zero, wrong chain format, or a contract like the token) (`payTo.valid`) | 2 | 0.1% | 2 | yes |
| 11 | Wrong amount field name for the version (`schema.amount-field`) | 1 | 0.1% | 1 | yes |
| 12 | Asset isn't a valid token address (`asset.address`) | 1 | 0.1% | 1 | yes |
| 13 | Required fields missing (`schema.required-fields`) | 1 | 0.1% | 1 | yes |
| 14 | 402 has no readable x402 challenge (`handshake.challenge-decode`) | 1 | 0.1% | 1 | yes |
| 15 | Token doesn't support EIP-3009 (needs permit2) (`asset.eip3009`) | 1 | 0.1% | 1 | yes |

### EIP-712 domain mismatches seen live

- MegaETH: declared "USDm"/v2, token is "MegaUSD"/v1: 1 endpoints
- Base: declared "USDC"/v2, token is "USD Coin"/v2: 1 endpoints
- Polygon: declared "USD Coin"/v2, token is "USD Coin (PoS)"/?: 1 endpoints

## Warnings

| warning | endpoints | % of live |
|---|---:|---:|
| No CORS on the 402, or PAYMENT-RESPONSE not exposed (`handshake.cors-expose`) | 866 | 63.7% |
| Slow 402 (> 1s) (`handshake.latency`) | 329 | 24.2% |
| Legacy v1, or header/body version disagree (`handshake.version`) | 270 | 19.9% |
| HEAD served without payment (`handshake.head`) | 177 | 13% |
| payTo is a contract (`payTo.contract`) | 125 | 9.2% |
| resource URL doesn't match the endpoint (`schema.resource-url`) | 42 | 3.1% |
| maxTimeoutSeconds out of range (`schema.timeout`) | 42 | 3.1% |
| Asset address checksum invalid (`asset.checksum`) | 32 | 2.4% |
| Network id not strict CAIP-2 / unrecognized (`schema.network`) | 13 | 1% |
| Unknown payment scheme (`schema.scheme`) | 7 | 0.5% |
| Amount is zero or has leading zeros (`schema.amount-format`) | 6 | 0.4% |
| Non-critical required fields missing (e.g. maxTimeoutSeconds, description) (`schema.required-fields`) | 3 | 0.2% |
| payTo checksum invalid (`payTo.checksum`) | 3 | 0.2% |
| Non-spec assetTransferMethod extension (`schema.transfer-method`) | 2 | 0.1% |
| Price looks mis-scaled (`asset.price-sanity`) | 1 | 0.1% |

## Catalog-wide EIP-712 domain audit

Static check of every EVM exact/eip3009 payment option listed in the discovery catalogs (no endpoint contacted). 36,353 cataloged resources declare an EVM eip3009 option; 36,350 of them have at least one such option x402-doctor could verify on-chain, and **49 (0.1%)** declare a domain that doesn't match the token. The rest are on chains without a keyless RPC in x402-doctor ("skip") or sign for a separate verifying contract such as Circle Gateway, which is checked off-chain ("separate verifier").

| network | token | declared name / version | on-chain | resources |
|---|---|---|---|---:|
| Base | USDC | "USD Coin" / 2 | matches | 32034 |
| Base Sepolia | USDC | "USDC" / 2 | matches | 6427 |
| Polygon | USDC | "USD Coin" / 2 | matches | 3283 |
| Arbitrum | USDC | "USD Coin" / 2 | matches | 2541 |
| Monad | USDC | "USDC" / 2 | matches | 877 |
| eip155:4663 | 0x5fc5360D | "Global Dollar" / 1 | skip (no RPC) | 715 |
| eip155:5042 | 0x36000000 | "GatewayWalletBatched" / 1 | skip (no RPC) | 651 |
| Avalanche | USDC | "USD Coin" / 2 | matches | 627 |
| OP Mainnet | USDC | "USD Coin" / 2 | matches | 621 |
| Sei | USDC | "USDC" / 2 | matches | 607 |
| Celo | USDC | "USDC" / 2 | matches | 603 |
| OP Mainnet | USDC | "GatewayWalletBatched" / 1 | separate verifier | 552 |
| Base | EURC | "EURC" / 2 | matches | 272 |
| eip155:480 | 0x79a02482 | "USDC" / 2 | skip (no RPC) | 242 |
| Base | USDC | "GatewayWalletBatched" / 1 | separate verifier | 213 |
| X Layer | USD₮0 | "USD₮0" / 1 | matches | 125 |
| eip155:5042 | 0x36000000 | "USDC" / 2 | skip (no RPC) | 99 |
| eip155:56 | 0x8d0d000e | "World Liberty Financial USD" / 1 | skip (no RPC) | 81 |
| eip155:480 | 0x1C60ba0A | "EURC" / 2 | skip (no RPC) | 79 |
| eip155:999 | 0xb88339CB | "USDC" / 2 | skip (no RPC) | 45 |
| eip155:480 | 0x79A02482 | "GatewayWalletBatched" / 1 | skip (no RPC) | 41 |
| Ethereum | USDC | "GatewayWalletBatched" / 1 | separate verifier | 38 |
| Avalanche | USDC | "GatewayWalletBatched" / 1 | separate verifier | 38 |
| Arbitrum | USDC | "GatewayWalletBatched" / 1 | separate verifier | 38 |
| eip155:130 | 0x078d782b | "GatewayWalletBatched" / 1 | skip (no RPC) | 38 |

## Distribution (live endpoints)

- Versions: v2 1274, v1 85
- Networks (payment options): Base 1373, Solana 389, Polygon 127, Arbitrum 109, Base Sepolia 62, xrpl:0 58, X Layer 47, eip155:56 44, eip155:480 36, Monad 32
- Assets: USDC 2095, other 262, USD₮0 39, OUSD 34, USDG 8, WETH 3, WBTC 2, EURC 2
- Schemes: exact 2458, batch-settlement 5, upto 5, long-events-stable-txhash 3, aggr_deferred 2, eip3009 1, onchain-proof 1, exact_cosmos_authz 1, unknown 1, long-events-txhash 1, 4mica-credit 1
- CORS on the 402: none 807, ok 298, no-expose 192, partial 59, skip 3
- Testnet-only endpoints: 37
- 402 latency: median 703 ms, p90 1370 ms

## Method

- Discovery: 38,020 unique URLs on 2,780 hosts. 18,092 catalog entries are POST-only and were not probed (x402-doctor only sends GET/HEAD/OPTIONS in scans).
- Sampling: GET-able catalog entries, up to 1 per host, stable hash order.
- Probe: unpaid GET + HEAD + CORS GET + OPTIONS preflight, concurrency <= 4, one request at a time per host, never sends payment headers.
- Confirmation: every failing endpoint re-probed serially; only failures that reproduce are counted; rate limits, timeouts, WAF blocks are 'inconclusive', not failures.
- On-chain reads: keyless public RPCs; RPC errors are inconclusive, never failures.
- Endpoints are anonymized here: the JSON uses random per-report ids (salted, salt never written), and each row carries only outcome, score and check ids, not the networks or prices that could be matched against the public catalogs. Per-endpoint raw data stays local so owners can fix things before anyone is named.
