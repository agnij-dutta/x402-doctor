---
name: Bug report
about: A check is wrong (false positive, false negative) or the CLI misbehaves
labels: bug
---

**Endpoint or challenge**
The URL you ran against, or the decoded `PAYMENT-REQUIRED` JSON if the endpoint is private.

**Command and output**

```
npx @0xholmes/x402-doctor <url> --json
```

**What you expected**
For a disputed check: why the endpoint does or doesn't settle (a facilitator `/verify` result or a settled transaction is the best evidence).

**Environment**
x402-doctor version (`--version`), Node version, OS.
