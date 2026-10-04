import { keccak_256 } from "@noble/hashes/sha3.js";

const enc = new TextEncoder();

export function keccakHex(data: Uint8Array | string): string {
  const bytes = typeof data === "string" ? enc.encode(data) : data;
  return "0x" + Buffer.from(keccak_256(bytes)).toString("hex");
}

export function selector(signature: string): string {
  return keccakHex(signature).slice(0, 10);
}

export const ADDRESS_REGEX = /^0x[0-9a-fA-F]{40}$/;
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export function toChecksumAddress(addr: string): string {
  const lower = addr.toLowerCase().replace(/^0x/, "");
  const hash = Buffer.from(keccak_256(enc.encode(lower))).toString("hex");
  let out = "0x";
  for (let i = 0; i < 40; i++) {
    out += parseInt(hash[i]!, 16) >= 8 ? lower[i]!.toUpperCase() : lower[i];
  }
  return out;
}

/** "valid" | "bad-checksum" | "no-checksum" (all lower/upper) */
export function checksumStatus(addr: string): "valid" | "bad-checksum" | "no-checksum" {
  const body = addr.slice(2);
  if (body === body.toLowerCase() || body === body.toUpperCase()) return "no-checksum";
  return toChecksumAddress(addr) === addr ? "valid" : "bad-checksum";
}

function hexToBytes(hex: string): Uint8Array {
  return Uint8Array.from(Buffer.from(hex.replace(/^0x/, ""), "hex"));
}

function pad32(hex: string): string {
  return hex.replace(/^0x/, "").padStart(64, "0");
}

export const EIP712_DOMAIN_TYPEHASH = keccakHex("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

export function domainSeparator(name: string, version: string, chainId: number, verifyingContract: string): string {
  const encoded =
    pad32(EIP712_DOMAIN_TYPEHASH) +
    pad32(keccakHex(name)) +
    pad32(keccakHex(version)) +
    pad32(BigInt(chainId).toString(16)) +
    pad32(verifyingContract.toLowerCase());
  return keccakHex(hexToBytes(encoded));
}

// ---------- ABI decoding (just what we need) ----------

function word(data: string, i: number): string {
  return data.slice(2 + i * 64, 2 + (i + 1) * 64);
}

export function decodeUint(data: string): bigint | undefined {
  if (!data || data === "0x" || data.length < 66) return undefined;
  return BigInt("0x" + word(data, 0));
}

function decodeStringAt(data: string, byteOffset: number): string | undefined {
  const start = 2 + byteOffset * 2;
  const lenHex = data.slice(start, start + 64);
  if (lenHex.length < 64) return undefined;
  const len = Number(BigInt("0x" + lenHex));
  if (len > 4096) return undefined;
  const strHex = data.slice(start + 64, start + 64 + len * 2);
  if (strHex.length < len * 2) return undefined;
  return Buffer.from(strHex, "hex").toString("utf8");
}

/** Decode an ABI `string` return; falls back to bytes32 strings (e.g. MKR-style tokens). */
export function decodeString(data: string): string | undefined {
  if (!data || data === "0x") return undefined;
  if (data.length >= 2 + 128) {
    const offset = Number(BigInt("0x" + word(data, 0)));
    if (offset === 32) {
      const s = decodeStringAt(data, offset);
      if (s !== undefined) return s;
    }
  }
  if (data.length === 66) {
    return Buffer.from(data.slice(2), "hex").toString("utf8").replace(/\0+$/, "");
  }
  return undefined;
}

export interface Eip5267Domain {
  fields: number;
  name: string;
  version: string;
  chainId: bigint;
  verifyingContract: string;
}

/** Decode eip712Domain() return: (bytes1,string,string,uint256,address,bytes32,uint256[]) */
export function decodeEip712Domain(data: string): Eip5267Domain | undefined {
  try {
    if (!data || data.length < 2 + 64 * 7) return undefined;
    const fields = parseInt(word(data, 0).slice(0, 2), 16);
    const nameOff = Number(BigInt("0x" + word(data, 1)));
    const verOff = Number(BigInt("0x" + word(data, 2)));
    const chainId = BigInt("0x" + word(data, 3));
    const verifyingContract = "0x" + word(data, 4).slice(24);
    const name = decodeStringAt(data, nameOff);
    const version = decodeStringAt(data, verOff);
    if (name === undefined || version === undefined) return undefined;
    return { fields, name, version, chainId, verifyingContract };
  } catch {
    return undefined;
  }
}

export const SELECTORS = {
  name: selector("name()"),
  version: selector("version()"),
  symbol: selector("symbol()"),
  decimals: selector("decimals()"),
  DOMAIN_SEPARATOR: selector("DOMAIN_SEPARATOR()"),
  eip712Domain: selector("eip712Domain()"),
  authorizationState: selector("authorizationState(address,bytes32)"),
};

export function encodeAuthorizationState(): string {
  // authorizationState(0x...01, 0x00..00): pure view, used only to detect EIP-3009 support.
  return SELECTORS.authorizationState + pad32("1") + pad32("0");
}
