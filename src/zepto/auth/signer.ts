/**
 * Zepto BFF request signing — pure Node reimplementation of chunk 3133
 * (modules 53133 + 23621), verified against a live captured request.
 *
 * Every signed BFF call carries two computed headers:
 *   request-signature = SHA-256( canonical )
 *   x-timezone        = SHA-256( request-signature )     (misnamed; it's a double hash)
 *
 * canonical = the values of { body, deviceId, method, requestId, secret, url },
 * keys sorted alphabetically, joined with "|":
 *
 *     body | deviceId | method | requestId | secret | url
 *
 * where:
 *   method  = lowercased HTTP method ("get", "post", …)
 *   url     = request URL pathname (+ "?query" when present)  — NOT the full URL
 *   body    = undefined for GET, else the exact JSON string sent
 *   secret  = the XSRF-TOKEN cookie value (url-decoded — what readCookie() returns)
 *   deviceId / requestId = the device_id / request_id sent on the same request
 *
 * Verified: SHA-256("2510db…d657d") === the captured x-timezone "13cbe5…ff34c".
 */
import { createHash } from "node:crypto";

export function sha256hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

export interface SignatureParts {
  body: string | undefined;
  deviceId: string;
  method: string; // will be lowercased
  requestId: string;
  secret: string;
  url: string; // pathname (+ ?query)
}

export interface SignatureHeaders {
  signature: string;
  timezone: string;
  canonical: string; // returned for debugging only
}

/** Build the canonical string + the two signature headers. */
export function sign(parts: SignatureParts): SignatureHeaders {
  const ordered: Record<string, string | undefined> = {
    body: parts.body,
    deviceId: parts.deviceId,
    method: parts.method.toLowerCase(),
    requestId: parts.requestId,
    secret: parts.secret,
    url: parts.url,
  };
  // Object.keys are already alphabetical here, but sort explicitly to match the source.
  const canonical = Object.keys(ordered)
    .sort()
    .map((k) => ordered[k] ?? "") // undefined (GET body) → "" exactly like Array.join
    .join("|");
  const signature = sha256hex(canonical);
  const timezone = sha256hex(signature);
  return { signature, timezone, canonical };
}
