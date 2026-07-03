import { sha512 } from "@noble/hashes/sha512";
import { sha256 } from "@noble/hashes/sha256";
import * as ed from "@noble/ed25519";

ed.etc.sha512Sync = (...messages: Uint8Array[]) => sha512(ed.etc.concatBytes(...messages));

const fiveMinutesMs = 300_000;

export async function verifyKiwifyRequest(request: Request, rawBody: string, token: string, publicKeyPem?: string) {
  const signature = request.headers.get("x-kiwify-digital-signature");
  const timestamp = request.headers.get("x-kiwify-timestamp");

  if (signature && timestamp && publicKeyPem) {
    return verifyDigitalSignature(new URL(request.url).pathname, rawBody, signature, timestamp, publicKeyPem);
  }

  const headerToken =
    request.headers.get("x-kiwify-token") ??
    request.headers.get("x-webhook-token") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

  if (headerToken) {
    return timingSafeEqualString(headerToken, token);
  }

  return null;
}

export function verifyPayloadToken(payloadToken: string | undefined, expectedToken: string) {
  return typeof payloadToken === "string" && timingSafeEqualString(payloadToken, expectedToken);
}

async function verifyDigitalSignature(
  path: string,
  rawBody: string,
  signatureBase64Url: string,
  timestamp: string,
  publicKeyPem: string,
) {
  const timestampMs = Number(timestamp);
  if (!Number.isInteger(timestampMs) || Math.abs(Date.now() - timestampMs) > fiveMinutesMs) {
    return false;
  }

  const message = `${path}:POST:${rawBody}:${timestamp}`;
  const digest = sha256(new TextEncoder().encode(message));
  const signature = base64UrlToBytes(signatureBase64Url);
  const publicKey = pemToDerBytes(publicKeyPem);

  if (!publicKey) return false;

  return ed.verifyAsync(signature, digest, publicKey);
}

/**
 * SEC-02: Compares two strings in constant time to prevent timing side-channel attacks.
 *
 * Both buffers are padded to the same length before calling `timingSafeEqual` so that
 * the comparison always takes the same amount of time regardless of input lengths.
 * The final result is only `true` when the original byte lengths also match.
 */
function timingSafeEqualString(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const maxLen = Math.max(leftBytes.byteLength, rightBytes.byteLength);

  // Pad both buffers to the same length so timingSafeEqual always runs in constant time.
  const padLeft = new Uint8Array(maxLen);
  const padRight = new Uint8Array(maxLen);
  padLeft.set(leftBytes);
  padRight.set(rightBytes);

  // timingSafeEqual ALWAYS executes — no early return on length mismatch.
  const bytesMatch = crypto.subtle.timingSafeEqual(padLeft, padRight);

  // Only return true when both the content AND the original lengths match.
  return leftBytes.byteLength === rightBytes.byteLength && bytesMatch;
}

function base64UrlToBytes(input: string) {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(input.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

/**
 * SEC-06: Extracts the 32-byte raw Ed25519 public key from a PEM-encoded SPKI structure.
 *
 * A standard SubjectPublicKeyInfo (SPKI) DER for Ed25519 is exactly 44 bytes:
 *   - 12 bytes: ASN.1 header (algorithm identifier sequence)
 *   - 32 bytes: raw public key
 *
 * Raw 32-byte keys (no header) are also accepted. Any other length is rejected
 * to prevent silently passing arbitrary bytes as a public key.
 */
function pemToDerBytes(pem: string): Uint8Array {
  const base64 = pem
    .replace(/-----BEGIN PUBLIC KEY-----/g, "")
    .replace(/-----END PUBLIC KEY-----/g, "")
    .replace(/\s/g, "");
  const binary = atob(base64);
  const der = Uint8Array.from(binary, (char) => char.charCodeAt(0));

  if (der.length === 44) return der.slice(12); // Standard SPKI Ed25519: skip 12-byte ASN.1 header
  if (der.length === 32) return der;            // Raw 32-byte key
  throw new Error(`Invalid Ed25519 public key DER length: ${der.length}`);
}
