// Upstream references for the browser (CORS) fix texts. Each rule points at the x402 PR or issue
// that carries it. Until a PR is merged and released, the fix text says "in review (#N)"; once a
// release ships, set `released` and the text becomes "fixed in <package> >= <version>". It never
// points users at unreleased code as if it shipped.

export const UPSTREAM_REPO = "x402-foundation/x402";

export interface FixRef {
  /** PR or issue number in x402-foundation/x402. */
  n: number;
  kind: "pr" | "issue";
  /** What the reference covers, for the fix text. */
  about: string;
  /** Package(s) the fix ships in, for "fixed in ... >= version". */
  packages?: string;
  /** First released version carrying the fix; null until released. */
  released: string | null;
}

export const FIX_REFS = {
  /** The original report and thread consensus on browser clients. */
  thread: { n: 3722, kind: "issue", about: "browser clients can't read the 402", released: null },
  /** OPTIONS never matches a method-less ("*") paid route, so preflights aren't charged. */
  preflightRoute: { n: 3738, kind: "pr", about: "OPTIONS never matches a `*` route", packages: "@x402/core", released: null },
  /** TypeScript middlewares merge the x402 headers into Access-Control-Expose-Headers. */
  exposeTs: {
    n: 3774,
    kind: "pr",
    about: "TypeScript middlewares expose the x402 headers",
    packages: "@x402/express etc.",
    released: null,
  },
  /** Python and Go middlewares do the same. */
  exposePyGo: {
    n: 3794,
    kind: "pr",
    about: "Python and Go middlewares expose the x402 headers",
    packages: "x402 (Python), x402 Go",
    released: null,
  },
  /** Spec text: "Browser clients" (SHOULD-level). */
  spec: { n: 3809, kind: "pr", about: 'spec section "Browser clients"', released: null },
} satisfies Record<string, FixRef>;

/** "in review (x402-foundation/x402#N)" until released, then "fixed in <packages> >= <version>". */
export function refText(r: FixRef): string {
  if (r.kind === "issue") return `see ${UPSTREAM_REPO}#${r.n}`;
  if (r.released) return `fixed in ${r.packages ?? UPSTREAM_REPO} >= ${r.released} (${UPSTREAM_REPO}#${r.n})`;
  return `in review (${UPSTREAM_REPO}#${r.n})`;
}
