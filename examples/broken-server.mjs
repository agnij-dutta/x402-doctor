// A tiny x402 endpoint with two deliberate, common bugs, for trying x402-doctor locally.
//   GET /weather  -> 402 whose extra.name is "USD Coin" (Base mainnet USDC's EIP-712 name) on
//                    Base Sepolia, where USDC's name is "USDC". Every payment signature would fail.
//   GET /fixed    -> the same challenge with the correct domain.
// Both enable CORS but don't expose PAYMENT-REQUIRED, so browsers can't read the price.
// No dependencies: `node examples/broken-server.mjs`, then `npx @0xholmes/x402-doctor http://localhost:4020/weather`.
import http from "node:http";

const PORT = Number(process.env.PORT ?? 4020);
const BASE_SEPOLIA_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
// Any address works here: x402-doctor never signs or sends a payment.
const PAY_TO = "0x209693Bc6afc0C5328bA36FaF03C514EF312287C";

function challenge(url, name) {
  return {
    x402Version: 2,
    error: "PAYMENT-SIGNATURE header is required",
    resource: { url, description: "Weather report", mimeType: "application/json" },
    accepts: [
      {
        scheme: "exact",
        network: "eip155:84532",
        amount: "10000",
        asset: BASE_SEPOLIA_USDC,
        payTo: PAY_TO,
        maxTimeoutSeconds: 60,
        extra: { name, version: "2" },
      },
    ],
  };
}

const server = http.createServer((req, res) => {
  const path = (req.url ?? "/").split("?")[0];
  const name = path === "/weather" ? "USD Coin" : path === "/fixed" ? "USDC" : undefined;
  if (!name) {
    res.writeHead(404).end("not found");
    return;
  }
  res.setHeader("access-control-allow-origin", "*");
  if (req.method === "OPTIONS") {
    res.setHeader("access-control-allow-headers", "PAYMENT-SIGNATURE, Content-Type");
    res.writeHead(204).end();
    return;
  }
  const url = `http://localhost:${PORT}${path}`;
  res.setHeader("payment-required", Buffer.from(JSON.stringify(challenge(url, name))).toString("base64"));
  res.writeHead(402, { "content-type": "application/json" }).end("{}");
});

server.listen(PORT, () => console.log(`broken x402 example on http://localhost:${PORT}/weather (and /fixed)`));
