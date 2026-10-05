# Changelog

All notable changes to this project are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning: [SemVer](https://semver.org/).

## [Unreleased]

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

[Unreleased]: https://github.com/agnij-dutta/x402-doctor/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/agnij-dutta/x402-doctor/releases/tag/v0.1.0
