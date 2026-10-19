# Changelog

All notable changes to this project are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning: [SemVer](https://semver.org/).

## [Unreleased]

### Added

- Browser (CORS) readiness: a new `browser` category, shown as "Browser (CORS)", with nine checks: `cors.allow-origin`, `cors.allow-origin-single` (the `*, *` trap), `handshake.cors-expose`, `cors.expose-payment-response`, `handshake.cors-preflight` (with `data.reason`), `cors.preflight-not-charged` (402 preflights), `cors.vary-origin`, `cors.cache-control` and `cors.preflight-max-age`. They read the existing probes and send no extra requests.
- `report.browser` (`ready`, `blocked`, `not-browser-facing`, `refused`, `restricted`, `unknown`) and a browser line under the verdict.
- Probe evidence for the browser checks in `data.observed` on `cors.allow-origin`.
- `--origin <url>` and `--server-only`, and matching `origin` / `server-only` Action inputs.
- `Check.penalty` for advisories; `WEIGHTS.browserCap`.
- `scan --targets-from <raw file>` to re-probe an earlier scan's targets, and `scan compare --from --to` (counts only).
- Frozen browser-readiness scan metrics (`src/scan/browser-metrics.ts`) and a `browser` block in the scan JSON and REPORT.md.
- Fix texts reference the upstream x402 PRs (#3738, #3774, #3794, #3809) as "in review" until they are released.

### Changed

- The CORS checks moved from the `handshake` category to `browser`. Their ids are unchanged.
- No `Access-Control-Allow-Origin` on the 402 is now a zero-penalty advisory on `cors.allow-origin` (it was a -3 warn on `handshake.cors-expose`), so server-only endpoints keep a full score.
- A missing `PAYMENT-RESPONSE` in the expose list now warns under `cors.expose-payment-response` (same weight as before).
- A 402 preflight is reported by `cors.preflight-not-charged` instead of `handshake.cors-preflight`.
- The browser category costs at most 20 points in total.
- The CORS `Origin` probe of a POST/PUT/PATCH now sends `Content-Type: application/json`, like the unpaid request.

### Fixed

- `--json` output piped to another program could be cut off at the first 8 KB, because the CLI exited before stdout drained.

## [0.1.1] - 2026-10-06

### Changed

- Docs, examples and CLI help use the scoped package name: `npx @0xholmes/x402-doctor`.

## [0.1.0] - 2026-10-05

Published to npm on 2026-10-05 as [`@0xholmes/x402-doctor`](https://www.npmjs.com/package/@0xholmes/x402-doctor). The command it installs is `x402-doctor`.

### Added

- `x402-doctor <url>`: probes an x402 endpoint without paying and reports handshake, schema, on-chain asset, payTo and facilitator checks, each with a fix, plus a 0-100 score.
- EIP-712 domain verification: recomputes the domain separator from `extra.name`/`extra.version` and compares it to the token's `DOMAIN_SEPARATOR()`, falling back to `eip712Domain()` and then `name()`/`version()`. Honors `extra.verifyingContract`.
- x402 v1 and v2 support, EVM and Solana on-chain checks, schema checks for other networks.
- `--json` output, CI-friendly exit codes (`0`/`1`/`2`/`64`/`70`), `--min-score`, `--strict`, `--facilitator`, `--rpc`, `--offline`.
- `x402-doctor scan`: polite public scan of facilitator Bazaar catalogs with serial confirmation of every failure, an anonymized aggregate (`scan/<date>.json`, `scan/REPORT.md`) and `--rebuild-report`.
- Library API (`doctor`, `renderPretty`, `renderJson`, `RpcClient`, ...).
- Composite GitHub Action (`action.yml`) and an example workflow.
- First public scan, 2026-10-04: 1,696 endpoints, 1,359 live; see `scan/REPORT.md`.

[Unreleased]: https://github.com/agnij-dutta/x402-doctor/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/agnij-dutta/x402-doctor/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/agnij-dutta/x402-doctor/releases/tag/v0.1.0
