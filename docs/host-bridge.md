# Host bridge v1

The Link host authenticates the user and obtains consent before opening a Mini
App. It creates an authorized launch and installs this adapter in the permitted
main document:

```ts
window.__LinkMiniAppHost.request(packet): Promise<ResponsePacket>
```

SDK requests contain `{ version: 1, request_id: '<uuid>', method: 'init' }` or
`method: 'close'`. Responses contain the same version and request ID, and either
`result` or `error: { code: 'ACCESS_REVOKED' }`. `close` returns an empty result.
A JSON-string response is supported up to 64 KiB.

Error codes must match `[A-Z][A-Z0-9_]{0,63}`. Error packets must not also
contain a result. Malformed packets, invalid JSON, and incorrectly typed READY
fields fail with `INVALID_HOST_RESPONSE`. Unexpected adapter exceptions become
`HOST_ERROR`; their messages and causes are not exposed to the application.

`init` returns the current LaunchResponse using snake_case ProtoJSON:

```json
{
  "result": "LAUNCH_RESULT_READY",
  "launch_id": "<launch-uuid>",
  "ready": {
    "app_id": "<app-uuid>",
    "environment": "ENVIRONMENT_LIVE",
    "config_version": "<published-revision>",
    "expires_at": "<ISO-8601 time in the next 60 seconds>",
    "sub": "<pairwise-subject>",
    "scopes": ["profile"],
    "access_token": "<scoped opaque ma_ token>",
    "profile": { "name": "Alice", "username": "alice", "avatar_url": "" },
    "web": {
      "url": "https://miniapp.example.com/",
      "allowed_origins": ["https://miniapp.example.com"],
      "id_token": "<signed Mini Apps JWT>"
    }
  }
}
```

The environment is `ENVIRONMENT_TEST` or `ENVIRONMENT_LIVE`; JWT claims use
`test` or `live`. Older hosts may omit scopes and the access token: the SDK
assumes `profile` only, and `getUserInfo()` requires the newer access-token field.

## Host responsibilities

- Bind the bridge to the actual origin, main document, WebView, and launch.
  Enforce these checks in the host, not only in page JavaScript.
- Validate navigation and redirects. Never release credentials to iframes.
  Close the bridge after an external navigation, revocation, or configuration change.
- Require HTTPS in Live. Test may use HTTP loopback only with a registered exact
  origin and port. A local address does not replace authorization.
- READY launches and tokens last 60 seconds. On `init`, return the current READY
  only if more than 15 seconds remain. Otherwise create a new launch with
  `POST /api/v1/mini-apps/launches` and a new `operation_id`. Saved consent normally
  returns READY silently. Handle `CONSENT_REQUIRED` before releasing new data;
  other outcomes must fail the SDK request and close the screen.
- Keep the primary Link account token in the host. Release only scoped,
  short-lived Mini App tokens; never use URLs, storage, or broadcast messages.
- Stop releasing data after `close`. The Mini App backend's own session has a
  separate lifetime and is not automatically revoked by closing the host.

The SDK calls only `init` and `close`. Consent and availability are host concerns;
the SDK does not add scopes or call consent endpoints itself.
See the [browser adapter protocol](browser-host.md) for browser hosts.
