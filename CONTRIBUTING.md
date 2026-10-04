# Contributing to x402-doctor

Thanks for helping. The bar for a check is simple: it must be **right**. A false "this endpoint can't settle" is worse than a missed one, because people act on it.

## Setup

Requires Node 20 or newer.

```bash
git clone https://github.com/agnij-dutta/x402-doctor.git
cd x402-doctor
npm ci
```

| Command                           | What it does                                                                              |
| --------------------------------- | ----------------------------------------------------------------------------------------- |
| `npm test`                        | Vitest. Uses local mock x402 servers and a mock JSON-RPC, so no network access is needed. |
| `npm run lint`                    | ESLint (type-aware typescript-eslint). Must be clean.                                     |
| `npm run format` / `format:check` | Prettier.                                                                                 |
| `npm run typecheck`               | `tsc --noEmit` over `src` and `test`.                                                     |
| `npm run build`                   | Clean build to `dist/`.                                                                   |
| `npm run dev -- <url>`            | Run the CLI from source with tsx.                                                         |
| `node examples/broken-server.mjs` | A local endpoint with known bugs to point the CLI at.                                     |

Run all of them before opening a PR: `npm run lint && npm run format:check && npm run typecheck && npm test && npm run build`.

## Layout

```
src/
  cli.ts              argument parsing, exit codes
  doctor.ts           orchestrates one probe: handshake -> schema -> asset -> payTo -> facilitator; scoring
  http.ts             the unpaid HTTP probe (never sends payment headers)
  decode.ts           PAYMENT-REQUIRED / v1 body decoding and normalization across v1 and v2
  rpc.ts              keyless JSON-RPC client with fallback and caching
  evm.ts              ABI decoding, EIP-55, EIP-712 domain separator
  networks.ts         CAIP-2 tables, default RPCs, canonical addresses
  knownAssets.ts      known token EIP-712 domains: USDC, USDT0, MegaUSD (offline fallback)
  report.ts           terminal and JSON output
  checks/
    handshake.ts      status code, challenge location/encoding, CORS, HEAD, latency
    schema.ts         PaymentRequirements fields per version
    asset.ts          EVM token checks (+ asset-svm.ts for Solana, eip712-domain.ts, price.ts)
    payto.ts          recipient address checks
    facilitator.ts    /supported coverage
  scan/               public scan: discover -> select -> probe -> confirm -> aggregate -> render
test/
  helpers/mocks.ts    mock x402 server + mock JSON-RPC
  doctor.test.ts      end-to-end checks against mock routes
  unit.test.ts        encoders, decoders, scan logic
  cli.test.ts         exit codes and output
```

## Adding a check

1. **Pick the module** by what the check needs: only the HTTP response (`checks/handshake.ts`), only the challenge JSON (`checks/schema.ts`), or chain state (`checks/asset.ts`, `checks/payto.ts`).
2. **Give it a stable id** `<category>.<name>` (for example `schema.amount-format`). Ids are part of the JSON output and the scan data, so don't rename existing ones.
3. **Push a `Check`** with `status`, a `message` that names the exact field and value, and a `fix` that says what to change. Set `critical: true` only if a real client's payment cannot succeed because of it. That flag drives `settlementBroken` and caps the score at 49.
4. **Cite the source** in a comment: the x402 spec section, or the reference client/facilitator code that behaves this way.
5. **Errors are never failures.** Timeouts, rate limits, RPC errors and WAF pages must produce `unknown`. Use `rpcUnknown()` in the asset checks.
6. **Scope it.** Rules that hold for EVM or Solana often don't hold elsewhere (XRPL amounts are decimal strings, Algorand ids break strict CAIP-2). Check the namespace before failing.
7. **Test both sides.** Add a mock route in `test/doctor.test.ts` that fails the check and one that passes it. If the check reads chain state, add the contract to `defaultRpcState()` in `test/helpers/mocks.ts`.
8. **Document it** in the check table in `README.md`, and add a human title in `src/scan/titles.ts` so it reads well in scan reports.

## Running a scan

`npx tsx src/cli.ts scan` probes real third-party endpoints. Keep the defaults: concurrency is capped at 4 and one request per host at a time. Raw per-endpoint data is gitignored on purpose. Don't commit it, and don't publish per-host results.

After changing a check, re-aggregate an existing scan without probing anyone: `npx tsx src/cli.ts scan --rebuild-report --date YYYY-MM-DD`.

## Commits and PRs

Small, focused commits with plain messages. Fill in the PR template.
