import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { verifyIDToken } from "../server/verify.mjs";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const jwks = { keys: [{ ...publicKey.export({ format: "jwk" }), kid: "test", alg: "EdDSA", use: "sig" }] };
const now = 1900000000;
const base = { iss: "https://issuer.example", aud: "urn:link:miniapp:app:test", sub: "pairwise", app_id: "app", environment: "test", token_use: "miniapp_id", launch_id: "launch", jti: "one", iat: now, exp: now + 60 };
function signed(changes = {}, header = {}) {
  const encode = v => Buffer.from(JSON.stringify(v)).toString("base64url");
  const input = `${encode({ alg: "EdDSA", typ: "miniapp-id+jwt", kid: "test", ...header })}.${encode({ ...base, ...changes })}`;
  return `${input}.${sign(null, Buffer.from(input), privateKey).toString("base64url")}`;
}
test("server accepts only a signed, unexpired proof for the exact app/environment and consumes jti", async () => {
  const seen = new Set();
  const config = { issuer: base.iss, appId: "app", environment: "test", jwks, now, consumeJti: async (aud, jti) => { const key = `${aud}:${jti}`; if (seen.has(key)) return false; seen.add(key); return true; } };
  assert.equal((await verifyIDToken(signed(), config)).sub, "pairwise");
  await assert.rejects(verifyIDToken(signed(), config), /ALREADY_USED/);
  for (const change of [{ aud: "other" }, { environment: "live" }, { token_use: "access" }, { iss: "other" }, { exp: now }, { exp: now + 61 }, { sub: "" }]) {
    await assert.rejects(verifyIDToken(signed(change), config), /INVALID_MINIAPP/);
  }
  await assert.rejects(verifyIDToken(signed({}, { typ: "JWT" }), config), /INVALID_MINIAPP/);
  const parts = signed().split("."); parts[1] = Buffer.from(JSON.stringify({ ...base, sub: "attacker" })).toString("base64url");
  await assert.rejects(verifyIDToken(parts.join("."), config), /INVALID_MINIAPP/);
});
