// Public library API. The CLI (src/cli.ts) is a thin wrapper around doctor().
export { doctor, score, summarize, WEIGHTS } from "./doctor.js";
export { renderPretty, renderJson } from "./report.js";
export { decodeHeaderValue, buildChallenge, normalizeRequirement } from "./decode.js";
export { domainSeparator } from "./evm.js";
export { RpcClient, type RpcClientOpts, type RpcOutcome } from "./rpc.js";
export { DEFAULT_RPCS, PUBLIC_FACILITATORS } from "./networks.js";
export { VERSION } from "./http.js";
export type * from "./types.js";
