# Link Mini Apps JavaScript SDK

`@link-apps/miniapp` connects a Mini App to its authorized Link host. It provides
launch context, fresh user information, and a request to close the application.
ES modules and TypeScript declarations are included, with no runtime dependencies
or build step.

Version `0.1.0` is a release candidate and has not been published to npm.
Native host implementations and device testing are separate from this package.

## Installation

Until publication, install a verified archive from the repository:

```sh
npm ci --ignore-scripts
npm run check
mkdir -p dist
npm pack --pack-destination dist
# In your Mini App project:
npm install /absolute/path/link-apps-miniapp-0.1.0.tgz
```

After publication, use `npm install @link-apps/miniapp`.
The runtime requires a modern browser or WebView with `fetch`, Web Crypto,
ReadableStream, and AbortController. The optional browser adapter also requires
MessageChannel. SDK development requires Node.js 20+. Run `npm run check` locally
before publishing; `prepublishOnly` runs the same checks automatically.

## Launch and user information

Run the SDK in the main document after opening your Mini App from Link:

```js
import LinkMiniApp from '@link-apps/miniapp';

const context = await LinkMiniApp.init();
// context.user: { sub, name, username, avatarUrl }

const info = await LinkMiniApp.getUserInfo();
// { sub, name?, username?, avatarUrl?, phoneNumber?, phoneNumberVerified? }

// On a user action:
await LinkMiniApp.close();
```

`init()` obtains the current READY launch from the host and checks its origin,
environment, and expiry. It returns `idToken`, optional `accessToken`, `scopes`,
`user`, `appId`, `launchId`, `environment`, and `expiresAt` (Unix milliseconds).
The host authorizes the user and obtains consent before releasing this context.

Live requires HTTPS. Test also allows HTTP on `localhost`, `127.0.0.1`, or
`[::1]` when the exact origin, including its port, is registered for the app.
`sub` identifies a user within one application and environment.

Use `context.user` for display. To sign in to your own backend, send `idToken`
to your HTTPS endpoint, verify it on the server, and create your own session.
The Mini App never receives the primary Link account token.

## Permissions and fresh data

`getUserInfo()` calls `init()` to obtain the current scoped access token, then
requests `GET https://api-sdk.linkmessenger.me/miniapps/v1/userinfo`.
It checks that the subject matches the launch and returns only granted fields.
Concurrent calls share one request. Results are not cached, and an API error
never falls back to the initial profile as if it were fresh data.

The method does not accept tokens, user IDs, or scopes and does not request
consent. Configure permissions in Console before launch. `profile` is required;
`phone` requires project approval, environment configuration, and the user's
separate consent. Declining phone access does not prevent sign-in.
Changes to Live configuration require review.

```ts
import LinkMiniApp, { type MiniAppUserInfo } from '@link-apps/miniapp';

const info: MiniAppUserInfo = await LinkMiniApp.getUserInfo();
const phone = info.phoneNumber ?? null;
```

Missing fields are unavailable or not authorized. A phone number starts with
`+` followed by digits; its presence does not prove verification. The current
API does not supply `phoneNumberVerified`. Phone numbers are not included in
`context.user` or the ID token.

Launch tokens last 60 seconds. When a token is near expiry, the host creates a
new launch of the same app. Existing consent normally makes this silent;
`launchId` may change during a visit. The SDK asks the host for its current
token on each call. It sends the token only in `Authorization`, with cookies,
redirects, and caching disabled. Never put tokens in URLs, logs, or browser storage.

An integrator can configure a trusted API origin:

```js
import { createSDK } from '@link-apps/miniapp';

const miniApp = createSDK(window, { apiBaseUrl: trustedConfig.apiOrigin });
const info = await miniApp.getUserInfo();
```

Use an HTTPS origin with no path, query, fragment, or credentials. Do not take
this setting from a URL or untrusted user input. HTTP loopback is Test-only.

## Optional browser adapter

A trusted browser host can open a Mini App in a separate window:

```js
import LinkMiniApp from '@link-apps/miniapp';
import { installBrowserHost } from '@link-apps/miniapp/browser-host';

// Trusted build configuration, never a URL parameter.
installBrowserHost(window, { hostOrigin: 'http://localhost:3008' });
const context = await LinkMiniApp.init();
```

The adapter preserves an existing native bridge and checks the exact opener,
origin, and nonce. Scoped credentials travel over a document-bound MessagePort.
Revocation or document teardown closes the adapter and emits `linkminiapp:closed`;
handle this event by removing authorized content. Token expiry alone does not
close the channel: the host supplies a new launch on the next `init()`.

Your host must implement the documented protocol. Opening a Mini App URL in an
ordinary browser does not authorize it. See the browser-host guide for Next.js.

## Errors

Use `MiniAppError.code` for SDK calls. The SDK validates host responses and
normalizes adapter rejections without exposing raw host messages or causes.
Direct calls to the browser adapter may still reject with an ordinary `Error`.

| Code | Application action |
| --- | --- |
| `LINK_REQUIRED` | Ask the user to open the app from a compatible Link client |
| `AUTHORIZATION_REQUIRED` | Ask the host for a fresh authorized launch |
| `ACCESS_REVOKED` | Remove authorized content and end the current visit |
| `ORIGIN_NOT_ALLOWED`, `NOT_MAIN_FRAME` | Check the registered origin and main document |
| `HOST_TIMEOUT` | Check the host and offer a new launch |
| `HOST_ERROR` | Check the host integration and offer a new launch |
| `TRANSPORT`, `API_TIMEOUT`, `SERVICE_UNAVAILABLE` | Show a network error and let the user retry |
| `INVALID_CONFIG`, `INVALID_HOST_RESPONSE`, `INVALID_API_RESPONSE` | Correct the integration; discard the response |
| `HTTP_ERROR` | Handle another unsuccessful HTTP response |

A browser-blocked CORS response appears as `TRANSPORT`; JavaScript cannot read
its HTTP status. The SDK does not automatically retry 401/403 or request more
permissions. Older hosts without `access_token` support `init()`, but
`getUserInfo()` fails with `AUTHORIZATION_REQUIRED`.

## Documentation and development

- [Host bridge contract](https://github.com/linkmessengerme/miniapp-sdk-js/blob/main/docs/host-bridge.md)
- [Your own backend and sessions](https://github.com/linkmessengerme/miniapp-sdk-js/blob/main/docs/own-backend.md)
- [Browser host and Next.js](https://github.com/linkmessengerme/miniapp-sdk-js/blob/main/docs/browser-host.md)
- [Release procedure](https://github.com/linkmessengerme/miniapp-sdk-js/blob/main/docs/releasing.md)
- [Verification status](https://github.com/linkmessengerme/miniapp-sdk-js/blob/main/docs/verification.md)

`npm run check` verifies types, tests, and installation of the actual tarball in
an isolated project. The npm archive contains only the SDK, browser adapter,
declarations, README, changelog, and MIT license. The server verifier example,
tests, and repository documentation are not npm exports.
