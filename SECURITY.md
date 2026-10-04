# Security

## Reporting a vulnerability

Please report privately through GitHub's private vulnerability reporting: **Security -> Report a vulnerability** on https://github.com/agnij-dutta/x402-doctor. Don't open a public issue. You'll get an acknowledgement within a few days.

If you've found a misconfigured **third-party** x402 endpoint (with x402-doctor or otherwise), report it to that endpoint's owner, not here.

## What x402-doctor does and doesn't touch

- It **never signs or sends a payment**, and never sends `PAYMENT-SIGNATURE`, `X-PAYMENT` or `Authorization` headers. Requests are unpaid `GET`/`HEAD`/`OPTIONS` (or the method you pass with `-X`). This is covered by a test.
- It holds **no keys**. On-chain reads are `eth_call`, `eth_getCode` and `getAccountInfo` against public RPCs.
- The public scan sends at most 4 concurrent requests, one at a time per host, with an identifying User-Agent.

## In scope

- Anything that makes x402-doctor send a payment, a payment header or a state-changing request.
- Anything that makes it leak data it was given (RPC URLs with API keys from `--rpc` or `X402_DOCTOR_RPC_*`) to a third party.
- Code execution or file writes triggered by a malicious endpoint's response (it parses untrusted JSON and headers).
- Scan output that de-anonymizes endpoints in the published aggregate.

## Not in scope (known limitations)

- **A pass is not a guarantee of settlement.** x402-doctor checks the advertised challenge and chain state; it can't see the facilitator's live balance, the server's verification logic or the paid response.
- **Results depend on public RPCs.** A dishonest or stale RPC can produce wrong on-chain answers. Use `--rpc` with a node you trust for anything important.
- **The endpoint can lie to the probe.** A server can answer the unpaid probe differently from real clients.
- **Separate verifiers aren't checked.** Schemes that sign for an off-chain verifier (e.g. Circle Gateway batched settlement) are reported as inconclusive.
