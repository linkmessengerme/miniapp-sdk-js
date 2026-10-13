import { createPublicKey, verify } from "node:crypto";

// jwks MUST come from the configured Link JWKS endpoint, never from the token.
// consumeJti MUST atomically consume (aud,jti) until exp (e.g. Redis SET NX EX).
// Persist your own session and its retry receipt together at the application layer.
export async function verifyIDToken(token, { issuer, appId, environment, jwks, consumeJti, now = Math.floor(Date.now() / 1000) }) {
  const fail = () => { throw new Error("INVALID_MINIAPP_ID_TOKEN"); };
  if (typeof token !== "string" || token.length > 16384 || !issuer || !appId || !["test", "live"].includes(environment) || typeof consumeJti !== "function") fail();
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some(p => !/^[A-Za-z0-9_-]+$/.test(p))) fail();
  let header, claims;
  try { header = JSON.parse(Buffer.from(parts[0], "base64url")); claims = JSON.parse(Buffer.from(parts[1], "base64url")); } catch { fail(); }
  if (header?.alg !== "EdDSA" || header.typ !== "miniapp-id+jwt" || typeof header.kid !== "string" || header.crit !== undefined || header.b64 !== undefined) fail();
  const matches = jwks?.keys?.filter(k => k.kid === header.kid && k.kty === "OKP" && k.crv === "Ed25519" && k.alg === "EdDSA" && k.use === "sig");
  if (matches?.length !== 1) fail();
  let key;
  try { key = createPublicKey({ key: matches[0], format: "jwk" }); } catch { fail(); }
  if (!verify(null, Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2], "base64url"))) fail();
  const audience = `urn:link:miniapp:${appId}:${environment}`;
  if (!claims || claims.iss !== issuer || claims.aud !== audience || claims.token_use !== "miniapp_id" ||
      claims.app_id !== appId || claims.environment !== environment ||
      !Number.isInteger(claims.exp) || !Number.isInteger(claims.iat) || claims.exp <= now || claims.iat > now + 5 ||
      claims.exp <= claims.iat || claims.exp - claims.iat > 60 ||
      ![claims.sub, claims.jti, claims.launch_id].every(v => typeof v === "string" && v.length > 0 && v.length <= 128)) fail();
  if (!(await consumeJti(audience, claims.jti, claims.exp))) throw new Error("MINIAPP_ID_TOKEN_ALREADY_USED");
  return Object.freeze({ sub: claims.sub, appId, environment, launchId: claims.launch_id,
    profile: Object.freeze({ name: claims.name || "", username: claims.preferred_username || "", avatarUrl: claims.picture || "" }) });
}
