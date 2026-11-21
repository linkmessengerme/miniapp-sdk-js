# Link Mini Apps JavaScript SDK

`@link-apps/miniapp` connects a Mini App to its authorized Link host. It provides
launch context, fresh user information, and a request to close the application.
Version 0.3.0 adds `startParam`: a link can open a particular screen of your Mini App.
Version 0.2.0 added `onBack()` for host Back gestures.
ES modules and TypeScript declarations are included, with no runtime dependencies
or build step.

Native host implementations and device testing are separate from this package.
Authenticated production-browser `getUserInfo()` verification is still pending;
see the [verification status](https://github.com/linkmessengerme/miniapp-sdk-js/blob/main/docs/verification.md).

## Installation

```sh
npm install @link-apps/miniapp
```

The runtime requires a modern browser or WebView with `fetch`, Web Crypto,
ReadableStream, and AbortController. The optional browser adapter also requires
MessageChannel. SDK development requires Node.js 24.22.1+. Run `nvm install` and
`nvm use` to select `.nvmrc`, then run `npm run check` locally
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

### Opening a particular screen

A link to your Mini App may carry a value for it:

```
https://linkm.me/miniapps/<slug>?start=<value>
```

Link delivers the value unchanged as `context.startParam`; what it means is up
to you. It is 1 to 256 Latin letters, digits and `._-`, so it needs no URL
encoding. Without it, and on hosts released before SDK 0.3.0, the field is absent.

```js
const context = await LinkMiniApp.init();
// https://linkm.me/miniapps/shop?start=order.1042
const [kind, id] = (context.startParam ?? '').split('.');
if (kind === 'order' && /^\d+$/.test(id)) showOrder(id);
```

Anyone can write such a link, so treat the value as untrusted input: an
identifier you look up, never a URL to open, an API origin or proof of a right.
The host repeats the same value for the whole visit, including after a reload,
so apply it once when the page starts. Put such links in your posts, messages
and push notifications; the plain link without `start` opens the first screen.

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

The working-tree browser adapter can forward the private SDK's `pay` extension
when the trusted host advertises `payments_v1`. This update is unreleased; public
`LinkMiniApp` exposes `init`, `getUserInfo`, `onBack` and `close`, with no private
`pay`. Payment UI and native Back routing require a compatible host. See the host
bridge contract for checkout dismissal versus closing the whole Mini App.

## Back (unreleased)

Register after initialization, using your own modal/router APIs:

```js
await LinkMiniApp.init();
const unsubscribe = LinkMiniApp.onBack(() => {
  if (modal.isOpen()) { modal.close(); return true; }
  if (router.canGoBack()) { router.back(); return true; }
  return false; // Root: the host closes the entire Mini App.
});

// On component unmount:
// unsubscribe();
```

The host must advertise `back_v1`. Before successful `init()` or on an older host,
registration throws `BACK_NOT_SUPPORTED`. The newest active handler wins across
SDK instances. Unsubscribe is idempotent and restores the previous handler;
`false` closes immediately, without trying earlier handlers. No handler also
asks the host to close. Use app route state to determine root, not browser
`history.length`, which can include pages outside the Mini App.

A handler must return exactly `true` or `false`, synchronously or as a promise.
Errors, invalid results and the 1000 ms SDK deadline keep the Mini App open.
An async handler receives `{ signal }`: check `signal.aborted` before changing
UI after an await. Timeout, unsubscribe, close and teardown abort the signal;
late results are ignored. New Back events are ignored while a timed-out handler
is still running, so a slow router cannot be invoked twice. Keep handlers quick.
Duplicate host events do not invoke the handler twice.

An open native checkout consumes Back first and returns `dismissed` from the
internal `pay()` method; it does not invoke this handler or cancel the order.
`LinkMiniApp.close()` remains an explicit request to close the whole Mini App.
The client team must implement the
[event/ack protocol](https://github.com/linkmessengerme/miniapp-sdk-js/blob/main/docs/host-bridge.md#back-extension-unreleased)
and validate Android/iOS behavior. Local tests do not establish device support.

## Link header and screen edges (unreleased)

Link draws its header (Back, title, close and action buttons) as a transparent
overlay above your page, the same for every Mini App. Your page fills the whole
screen, and its content scrolls under the header. Keep your own content clear of
the header and the system bars with two classes:

```js
import '@link-apps/miniapp/ui.css';
```

```html
<body style="margin: 0">
  <main class="link-miniapp-page">
    <!-- Optional. As the first child it sticks to the top; its background
         reaches under the Link header and its content starts below it. -->
    <header class="link-miniapp-header">…</header>
    …
  </main>
</body>
```

`link-miniapp-page` starts its content below the Link header and away from the
notch, the rounded corners and the home indicator. Put your own spacing on
elements inside these two classes: a padding set on them replaces the offsets.
For elements with `position: fixed`, use the CSS variables directly, for example
`bottom: var(--link-miniapp-safe-area-bottom, 0px)`; the variables are listed in
the [host contract](https://github.com/linkmessengerme/miniapp-sdk-js/blob/main/docs/host-bridge.md#client-header-and-insets-unreleased).
Use them rather than `env(safe-area-inset-*)`, which does not know about the
Link header.

The same values are available in JavaScript, without `init()`:

```js
const { headerHeight, safeArea } = LinkMiniApp.getInsets();
const stop = LinkMiniApp.onInsetsChange(insets => layout(insets));
```

Outside Link and on older Link clients, which draw an opaque header above the
page, every value is `0`, so the same markup works everywhere.

To see the layout in an ordinary browser during development, draw a stand-in
for the Link header. It does nothing inside Link:

```js
if (import.meta.env.DEV) {
  const { installHeaderPreview } = await import('@link-apps/miniapp/preview');
  installHeaderPreview(window, { title: 'Shop' }); // or { device: 'desktop' }
}
```

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
| `BACK_NOT_SUPPORTED` | Initialize first; Back requires the new SDK and a `back_v1` host |
| `INVALID_BACK_HANDLER` | Pass a function returning a boolean to `onBack` |
| `INVALID_INSETS_LISTENER` | Pass a function to `onInsetsChange` |
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
layout stylesheet, header preview, declarations, README, changelog, and MIT license. The server verifier example,
tests, and repository documentation are not npm exports.
