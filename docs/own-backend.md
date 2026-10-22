# Your own backend and sessions

1. Link authenticates the account, obtains consent, and opens an authorized launch.
2. Your frontend calls `init()` and sends `idToken` to your HTTPS sign-in endpoint.
3. Your backend verifies the signature and claims, consumes the proof once, and
   finds its own account by `(appId, environment, sub)`.
4. Your backend issues its own session tokens or a secure HttpOnly cookie.
   Subsequent application requests use that session.

`context.user` is display data, not server-side proof of identity. The ID token
proves a launch; the opaque `ma_` access token fetches fresh Mini Apps UserInfo.
The developer's application does not need or receive the primary Link account token.

## ID token verification

[server/verify.mjs](../server/verify.mjs) is a dependency-free Node.js example to
adapt to your backend. It is not an npm export.

Configure these trusted values on your server:

- JWKS: `https://api-sdk.linkmessenger.me/miniapps/v1/jwks.json`.
- Issuer: `https://api-sdk.linkmessenger.me/miniapps`.
- Audience: `urn:link:miniapp:<app-id>:live` or `:test`.
- Algorithm: Ed25519/EdDSA; `typ=miniapp-id+jwt`; `token_use=miniapp_id`.

Verify the signature, issuer, exact audience, app ID, environment, `iat`, `exp`,
`sub`, `launch_id`, and `jti`. Proof lifetime must not exceed 60 seconds. Never
choose the key source, issuer, or audience from unverified token claims.
Fetch JWKS over HTTPS with a timeout, size bound, caching, and key rotation handling.

```js
import { verifyIDToken } from './verify.mjs';

const identity = await verifyIDToken(idToken, {
  issuer: 'https://api-sdk.linkmessenger.me/miniapps',
  appId: configuredAppId,
  environment: 'live',
  jwks: trustedCachedJWKS,
  consumeJti: async (audience, jti, expiresAt) => {
    // Atomically consume (audience, jti) until expiresAt, e.g. Redis SET NX EX.
    // Return true only for the first use.
    return replayStore.consumeOnce(audience, jti, expiresAt);
  },
});
// Create your own session for identity.sub.
```

Session storage, CSRF protection, rate limiting, JWKS caching, and endpoint
idempotency remain application responsibilities. A repeated `jti` must not
create another session. Persist the session and its retry receipt together so
that a lost response does not require consuming the same proof again.
Never log tokens. On page reload, try resuming your own valid session before
performing another ID-token exchange; never reuse an already consumed proof.

## UserInfo and revocation

`LinkMiniApp.getUserInfo()` obtains the current scoped token from the host.
Server-side callers use `GET /miniapps/v1/userinfo` with `Authorization: Bearer
<scoped-access-token>` and `Accept: application/json`. Match the returned `sub`
against your verified session. Fields may disappear after permission changes;
do not substitute cached data for a failed request as if it were current.

UserInfo does not extend tokens or add scopes. The host replaces an expiring
token with a new launch of the same app. `phone` requires project approval and
user consent. An absent `phone_number_verified` does not imply verification.

Revocation in Link ends runtime access and UserInfo authorization. Your own
backend session has an independent lifecycle: define its expiry, refresh, and
logout behavior. The SDK does not automatically revoke your backend tokens.
