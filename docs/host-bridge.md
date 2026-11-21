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
    "start_param": "<optional value of start from the opened link>",
    "web": {
      "url": "https://miniapp.example.com/",
      "allowed_origins": ["https://miniapp.example.com"],
      "id_token": "<signed Mini Apps JWT>"
    }
  }
}
```

`start_param` is the `start` query value of the link the user opened, returned by
the server in the READY launch; the host passes the launch on unchanged. It is
absent for a launch without it. A value that is not a string is
`INVALID_HOST_RESPONSE`; a string outside `^[A-Za-z0-9._-]{1,256}$` is not
exposed to the application. The host repeats the value in every launch it
creates for the same open Mini App, so a reload sees the same `init` result.

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

The public SDK requests `init` and `close` and, with `back_v1`, subscribes to Back
events and acknowledges them. Consent and availability are host concerns; the SDK
does not add scopes or call consent endpoints itself. The private SDK adds `pay`.
See the [browser adapter protocol](browser-host.md) for browser hosts.

## Back extension (unreleased)

The public and internal SDK expose `onBack(handler): () => void`. Call it after
`await init()`; the returned function unsubscribes idempotently. A handler returns
`true` (it closed a modal or navigated its router) or `false` (root: close the Mini
App). The latest active subscription across all SDK instances in the document
wins. Unsubscribing restores the previous subscription. A `false` result does
not call earlier handlers. Prefer one handler that checks modal, router, then root.

### Native adapter surface

In addition to `request`, install these methods in the authorized main document:

```ts
interface BackHostBridge {
  readonly capabilities: readonly string[]; // includes 'back_v1'
  readonly documentId: string;               // fresh nonzero canonical UUID
  subscribeBack(listener: (event: BackEventPacket) => void): () => void;
  ackBack(ack: BackAckPacket): void;
}
```

These types, plus `BackHandler` and `BackContext`, are exported by the new public
SDK. The native adapter owns one SDK listener, removes it on unsubscribe, and
does not deliver Back through a window DOM event or a global callback name.
`documentId` and capabilities are immutable for the document. Allocate a new
document ID on every full document navigation, even to the same origin, and on
account/app/environment replacement. A renewed launch token for the same identity
does not replace the document ID or reset the event sequence. SPA route changes
within that document keep the ID.

After a successful `init()`, the SDK automatically subscribes once if the bridge
advertises the complete extension. This happens even when the app has no handler,
allowing the SDK to explicitly request root closure. Before `init()` or without
support, `onBack()` throws `MiniAppError('BACK_NOT_SUPPORTED')`. Legacy SDKs never
subscribe; the host retains its legacy Back behavior for them. Do not advertise
`back_v1` or fake support until the whole contract is implemented.

### Event and acknowledgement

Host → originating document:

```json
{"version":1,"type":"link-miniapp:back","document_id":"<document-uuid>","event_id":1}
```

SDK → same host/document, via `ackBack`:

```json
{"version":1,"type":"link-miniapp:back-ack","document_id":"<same-document-uuid>","event_id":1,"action":"handled"}
```

`event_id` is a strictly increasing positive safe integer (`1` through
`Number.MAX_SAFE_INTEGER`), not a request UUID. Never reuse it for a new gesture.
Keep `request_id` correlation for `init`/`pay`/`close` separate from Back IDs. A
retry uses exactly the original document/event IDs. Only the host creates these
IDs; the Mini App cannot choose the document, app, account or native screen.

| SDK result | Ack action | Required host action |
| --- | --- | --- |
| Handler returns exactly `true` | `handled` | Keep Mini App open; JS already performed navigation. |
| Handler returns exactly `false`, or no handler | `close` | Close the whole Mini App once and tear down the bridge. |
| Throw/reject, invalid result, timeout, or active-handler unsubscribe | `ignored` | Keep Mini App open; perform no history or native navigation. |

The handler receives `{ signal: AbortSignal }`. The SDK waits at most **1000 ms**
from receipt of the event. The host independently waits at most **1500 ms** from
dispatch, using a native timer that does not depend on the WebView event loop.
Check monotonic elapsed time when accepting an ack too, so a delayed timer
callback cannot extend the deadline. The SDK also checks elapsed time at settle.
No ack, malformed ack, wrong document/event, a closed document or an expired
deadline cannot authorize closure: discard the answer and keep the Mini App open.
An explicit host Close control remains available if JS is unresponsive.

Coalesce additional Back gestures while an event is pending; do not queue a
second transition. Optionally retry that same event before the original deadline,
without extending it. The SDK invokes a handler at most once per event. While
running, duplicate delivery waits for the original result. A repeat of the most
recently acknowledged event can resend its cached ack; older IDs are ignored.
The host accepts only the first valid ack for its currently pending event and
ignores duplicates and late answers. It never both applies an ack and falls back
to `WebView.goBack()` or a native pop.

After SDK timeout/unsubscribe, the signal is aborted and late results are dropped.
While that handler is still settling, new events receive `ignored`; they cannot
reenter the handler or invoke an underlying router. JS cannot forcibly undo or
stop application side effects: check `signal.aborted` after every awaited step
and before changing UI. Prefer quick synchronous navigation handlers. A handler
that never settles keeps ignoring Back until a new document; use explicit Close.

Teardown (`linkminiapp:closed`, `pagehide`, persisted `pageshow`, `SDK.close()`),
bridge/origin/document replacement and identity change cancel pending dispatch.
Never deliver its ack into a replacement document. The host must clear its timer,
listener and pending event on navigation, revocation or closure. It must enforce
actual origin/main-frame identity itself; document IDs are correlation, not
credentials. Native adapters emit `linkminiapp:closed` on revocation/close while
the page is alive. SDK registration failures/ack transport failures invalidate
the local dispatcher rather than expose native error details.

The synthetic host in [`test/back-host.mjs`](../test/back-host.mjs) implements
event IDs, single pending event, retries, ack validation, checkout priority and
the host deadline. Public tests exercise a native-shaped fixture and real Node
MessagePorts. Internal packed-consumer tests cover checkout and shared Back.
These are executable contract examples, not verified native implementations.

## Payments extension (unreleased)

`@link-apps/miniapp-internal` adds `pay({ paymentSessionId })`. A compatible host
exposes `capabilities: Object.freeze(['payments_v1'])` on its injected bridge,
alongside `request`. Missing capability means `PAYMENTS_NOT_SUPPORTED`; the SDK
does not send `pay` to older hosts. Advertising the capability is not a payment
grant and does not replace server authorization.

Request:

```json
{
  "version": 1,
  "request_id": "<request-uuid>",
  "method": "pay",
  "params": { "checkout_session_id": "<checkout-uuid-from-merchant-backend>" }
}
```

Response:

```json
{
  "version": 1,
  "request_id": "<same-request-uuid>",
  "result": {
    "order_id": "<order-uuid>",
    "outcome": "completed",
    "payment_state": "ORDER_STATUS_PAID",
    "fulfillment_state": "FULFILLMENT_STATUS_PENDING"
  }
}
```

Alternatively return `error: { code: '<STABLE_CODE>' }`, with no result. Never
include OTP, raw phone, provider proofs or Link credentials. `outcome` is
`completed`, `pending` or `dismissed`. Order and fulfillment states use the
gateway enum names, excluding UNSPECIFIED. Completed requires PAID; pending
requires OPEN or PROCESSING. Dismissed can accompany any valid order state,
including PAID: it describes the UI, not cancellation or refund.

The host validates the actual app/environment/user/origin and main document,
not values supplied by JS. It calls the native checkout API
using its Link session, and obtains consent and OTP in native
UI. Only the Mini App backend creates the order; its OAuth `payments` token is
never passed to the web page. Fulfillment is confirmed by that backend.

Allow only one visible checkout per document. The SDK shares concurrent calls
for the same session and rejects another session with `PAYMENT_IN_PROGRESS`.
Enforce the same restriction in the host. The extension waits up to 30 minutes;
ordinary init/close requests retain their short timeout. A timeout is not a
payment result and must not trigger an automatic new purchase or cancellation.
Recover the existing checkout through the status API.

Return only to the initiating document. A refreshed launch ID for the same
identity is allowed. Navigation, closing the Mini App, revocation and account
changes invalidate delivery of the result. Emit `linkminiapp:closed` on teardown
if the document remains alive. The SDK also checks the current launch after the
response before exposing a safe, immutable result.

## Native Back, checkout dismissal and Mini App close

These are integration requirements for the client team; this package does not
implement or certify Android/iOS screen navigation.

- Back/swipe on the checkout closes that native screen and resolves `pay` with
  `dismissed` and the latest known order state. Keep the underlying Mini App open.
  Continue recovery of an already accepted payment; do not cancel the order.
- Otherwise, on a `back_v1` document with the SDK listener installed, use the
  event/ack contract above. The Mini App decides modal/router/root; the host closes
  only on `close`. Do not also navigate WebView history. Android system Back,
  toolbar Back and iOS back/swipe must all follow this decision. If a native
  interactive swipe cannot wait for the ack, disable that pop gesture in this
  container and route Back through a control that can wait.
- Serialize opening/dismissing checkout with pending Back. A `pay` request may
  wait while a Back decision is pending, but checkout must not appear over that
  decision. If Back closes the Mini App, discard the queued UI and payment result.
- `LinkMiniApp.close()` is an explicit request to close the whole Mini App. The
  host tears down the screen/bridge; pending `pay` calls fail with ACCESS_REVOKED.
  A button inside the page can use its own router/history for an in-app Back.

`onBack` subscribes to host gestures; it is not an imperative `back()` command.
The separate store bridge's `linkstore:back` protocol does not apply to Mini App
WebViews. WebView history alone does not define which native screen should close.

A Mini App implemented as a native client module uses that module's native
navigation stack. The JavaScript SDK and WebView history do not participate.

## Client header and insets (unreleased)

Every Link client draws the Mini App header (Back arrow when shown, title, close
and action buttons) as a transparent overlay above the page. The page fills the
whole screen and scrolls underneath the header. This is the same for every Mini
App; there is no per-app setting. The host reports where its header and the
system bars are, and the page keeps its own content clear of them.

### Layout the host provides

- The WebView fills the whole Mini App container: from the top edge of the screen,
  under the status bar, to the bottom edge, under the home indicator or the
  navigation bar. The host draws its header on top of the WebView.
- The host does not shift or pad the page itself: no automatic content insets, no
  `fitsSystemWindows` padding, no frame offset below the header. The page applies
  the values below. On iOS set `scrollView.contentInsetAdjustmentBehavior = .never`;
  on Android lay the WebView out edge to edge.
- The header spans the full width. It has no background, border or shadow. Each
  control and the title sit on their own backing, for example a translucent
  blurred capsule, so they stay legible over any content, light or dark. Status
  bar content follows the Link theme.
- Touches on header controls go to the host. Touches elsewhere in the header area,
  including between controls, go to the WebView, so a scroll that starts under the
  header still scrolls the page.

### CSS variables

Before the first page script runs, the host defines these custom properties on the
root element of the main document:

| Variable | Distance |
| --- | --- |
| `--link-miniapp-header-height` | From the top edge of the WebView to the bottom edge of the client header. Includes the status bar. |
| `--link-miniapp-safe-area-top` | Status bar, notch or Dynamic Island. Already inside the header height. |
| `--link-miniapp-safe-area-right` | Rounded corners and the notch in landscape, on the right. |
| `--link-miniapp-safe-area-bottom` | Home indicator, gesture bar or button navigation bar. |
| `--link-miniapp-safe-area-left` | Rounded corners and the notch in landscape, on the left. |

Values are CSS pixels with the `px` unit, for example `92px`. Each is measured from
the matching edge of the WebView, rounded up to a whole pixel and never negative.
iOS points and Android dp equal CSS pixels at the default WebView scale; do not
apply text zoom to these values. They are not added together: the header height
already contains the top safe area. The on-screen keyboard is not included.

Install them with a script that runs at document start, in the main frame only:

- iOS: `WKUserScript` with `.atDocumentStart` and `forMainFrameOnly: true`.
- Android: `WebViewCompat.addDocumentStartJavaScript`, limited to the app's allowed
  origins (feature `DOCUMENT_START_SCRIPT`).
- Desktop: the equivalent preload or document-start hook of the embedded browser.

The script adds a constructed stylesheet with one `:root { … }` rule to
`document.adoptedStyleSheets`. Frameworks do not manage adopted stylesheets, so the
values survive hydration and `<head>` updates. Where constructed stylesheets are
unavailable, set the properties on `document.documentElement.style`. Do not
insert `<style>` elements into the page markup.
`installHeaderPreview()` in [`preview.js`](../preview.js) defines the variables the
same way and can serve as a reference for the script.

When a value changes (rotation, window resize on desktop, split view, a changed
header size after an accessibility text size change), update the rule in the live
document, then call `window.dispatchEvent(new Event('linkminiapp:insets'))`.
Apply the update in the same frame as the native layout change so that the
header and the page move together. Do not dispatch the event when nothing changed.
Keep the document-start script current too, so the next navigation starts with
the new values.

Older hosts, the browser host and ordinary browsers define none of these
variables. Pages read them with a `0px` fallback, so the same CSS also works
there: an older host draws an opaque header above the WebView. The values describe
layout only and are not a security boundary; the page can read and override them
in its own document.

### What the page does

The page offsets its content with these variables, never with
`env(safe-area-inset-*)` alone: `env()` does not know about the Link header, and
`viewport-fit=cover` is not required. A page without its own header pads its
scrolling container; the content then scrolls under the Link header:

```css
.page {
  padding-top: var(--link-miniapp-header-height, 0px);
  padding-right: var(--link-miniapp-safe-area-right, 0px);
  padding-bottom: var(--link-miniapp-safe-area-bottom, 0px);
  padding-left: var(--link-miniapp-safe-area-left, 0px);
}
```

A page with its own sticky header extends the header's background under the Link
header and starts its content below it. The page container then has no top
padding of its own:

```css
.app-header {
  position: sticky;
  top: 0;
  padding-top: var(--link-miniapp-header-height, 0px);
}
```

Elements with `position: fixed` use the same values, for example
`top: var(--link-miniapp-header-height, 0px)` or
`bottom: var(--link-miniapp-safe-area-bottom, 0px)`. The SDK ships ready-made
classes for both patterns, `link-miniapp-page` and `link-miniapp-header` in
`@link-apps/miniapp/ui.css`, and reads the current values from JavaScript with
`getInsets()` and `onInsetsChange()`.

### Host checklist

- WebView edge to edge; no native content insets or padding.
- Transparent header across the full width; each control and the title legible on
  their own backing; touches outside controls reach the page.
- All five variables defined at document start in the main frame, in CSS pixels,
  rounded up.
- Live update plus `linkminiapp:insets` on every change, and nothing when unchanged.
- The same behaviour on iOS, Android and Desktop, for every Mini App.
