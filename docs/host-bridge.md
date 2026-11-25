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

## Header extension (unreleased)

`header_v1` lets the page ask the client to change its header: the left button,
a confirmation before closing, own items in the ⋯ menu, minimize events, the
colour of the header buttons and a compact header for games. The page asks; the
client decides how to draw it and enforces the rules below itself.

### Rules the page cannot change

- The user can always close and minimize the Mini App. Close stays in the ⋯ menu
  in every state, and in the corner capsule in fullscreen. Minimize stays as ⌄ in
  the capsule, or as a menu item in fullscreen.
- Link menu items always remain, after the page's own items, in their own group.
- The page cannot change the title, the app icon, the verified mark or the test
  label. It may hide the title capsule as a whole; Link then shows the icon and
  name as the first, non-interactive row of the ⋯ menu, and for a Test launch
  keeps a small amber "тест" label next to the capsule.
- The close confirmation is a Link dialog with fixed text. Close is always one of
  its buttons. It never appears for a close the user did not start.
- Settings belong to one document. A full navigation, a reload, a new document ID,
  revocation or closing returns the header to the defaults.
- Only after a successful `init()`, only in the authorized main document. A host
  that advertises `header_v1` also implements `back_v1`.

### Native adapter surface

```ts
interface HeaderHostBridge {
  readonly capabilities: readonly string[]; // includes 'header_v1' and 'back_v1'
  readonly documentId: string;               // the same document ID as back_v1
  setHeaderState(packet: HeaderStatePacket): void;
  subscribeHeader(listener: (event: HeaderEventPacket) => void): () => void;
}
```

The request method `minimize` (same envelope as `close`) minimizes the app and
returns an empty result, or `error: { code: 'MINIMIZE_NOT_AVAILABLE' }` when the
app is already minimized, closing, or behind a Link dialog. Without
the capability the SDK throws `HEADER_NOT_SUPPORTED` and sends nothing, so older
hosts keep their behaviour.

### Header state, page → host

```json
{"version":1,"type":"link-miniapp:header-state","document_id":"<document-uuid>","revision":3,
 "state":{"back_button":"auto","close_confirmation":false,"icons":"auto","title":"shown","fullscreen":false,
          "orientation":"auto","menu_items":[{"id":"settings","title":"Настройки","icon":"settings"}]}}
```

The packet always carries the whole state. `revision` is a strictly increasing
positive safe integer per document, chosen by the SDK; the host applies a packet
only if its revision is higher than the last applied one, and otherwise ignores
it. The SDK merges calls made together into one packet and sends nothing when the
state equals the last one sent. The host may apply at most one per frame and keeps
the last. A menu title is also limited to 128 UTF-16 code units, so the largest
valid state stays far below the 8 KiB limit.

The host validates every field and ignores the whole packet when one is invalid,
keeping the previous state; unknown extra fields are ignored. Packets larger than
8 KiB are invalid.

| Field | Values | Default |
| --- | --- | --- |
| `back_button` | `auto`, `back`, `close`, `hidden` | `auto` |
| `close_confirmation` | boolean | `false` |
| `menu_items` | 0–5 items | `[]` |
| `icons` | `auto`, `light`, `dark` | `auto` |
| `title` | `shown`, `hidden` | `shown` |
| `fullscreen` | boolean | `false` |
| `orientation` | `auto`, `portrait`, `landscape` | `auto` |

A menu item has `id` (`^[a-z0-9_-]{1,32}$`, unique), `title` (plain text, 1–32
grapheme clusters after trimming, no control, line-separator or bidirectional
override characters) and an optional `icon` from the list in `header.js`
(`MENU_ICONS`). Draw an unknown icon name as no icon. Draw every name with the
Link icon below, in the same outline style, size and colour as the Link menu
items; pages never supply images.

| Name | Android drawable |
| --- | --- |
| `settings` | `ic_settings_24` |
| `info` | `ic_info_tinted_24` |
| `help` | `ic_help_24` |
| `star` | `ic_fluent_star_24_regular` |
| `bookmark` | `ic_post_bookmark_regular` |
| `edit` | `ic_compose_outline_24` |
| `search` | `ic_search_24` |
| `bell` | `ic_bell_24` |
| `user` | `ic_fluent_person_24_regular` |
| `gift` | `ic_gift_24` |
| `cart` | `ic_fluent_cart_24_regular` |
| `list` | `ic_list_20` |
| `chat` | `ic_fluent_chat_empty_24_regular` |
| `sound` | `ic_fluent_speaker_2_24_regular` |
| `mute` | `ic_fluent_speaker_mute_24_regular` |
| `pause` | `ic_fluent_pause_24_filled` (filled, like all Link playback icons) |
| `play` | `ic_fluent_play_24_filled` (filled) |
| `restart` | `ic_retry_24` |
| `rules` | `ic_fluent_document_24_regular` |

iOS and desktop use the same drawings. Render titles as plain
text. Drop an item whose title equals a Link menu item in the current language,
ignoring case.

### Behaviour

- `back_button: auto` is today's behaviour: ‹ when the page can go back, ✕
  otherwise. `back` always shows ‹ and `close` always shows ✕. `hidden` shows no
  left button. A tap on ‹ is a Back gesture under `back_v1`; a tap on ✕ is a user
  close. System Back and edge swipes keep following `back_v1` in every mode.
- `close_confirmation: true` asks before closes the user starts: ✕, the menu's
  Close item, ✕ on the minimized bar, a close gesture, and a Back gesture whose
  ack is `close`. It does not ask for `LinkMiniApp.close()`, minimize, revocation,
  sign-out, account switch or a forced close by Link. When a fourth minimized app
  must close another, prefer one without confirmation; otherwise close the oldest
  as before.
- `menu_items` appear first in the ⋯ menu, in their own group, followed by the Link
  groups. A tap closes the menu and sends `menu_item`.
- `icons` sets the ink of the header controls, the title and the status bar over
  the page: `light` for a dark page, `dark` for a light page. `auto` keeps the
  client's own choice. The page cannot set the header colour itself.
- `title: hidden` removes the capsule with the icon and name. The header row keeps
  its height; the left button and the capsule stay where they were, and the gap
  between them is reported as `free` in `getHeaderLayout()`. The ⋯ menu starts with
  the icon and name. `setHeaderStyle()` changes only the keys it is given.
- `fullscreen` and `orientation` follow the layout rules below.

### Layout: apps and games, portrait and landscape

The header must not get in the way. In every layout the page fills the whole
WebView, touches outside the host controls reach the page, and the page learns
where the controls are from CSS variables, not from fixed numbers.

A header_v1 host defines four more variables next to the five of 0.4.0, always,
in every layout:

| Variable | Distance |
| --- | --- |
| `--link-miniapp-controls-top` | From the top edge of the WebView to the top of the ⋯ capsule. |
| `--link-miniapp-controls-right` | From the right edge of the WebView to the right end of the capsule. |
| `--link-miniapp-controls-width` | Width of the capsule. |
| `--link-miniapp-controls-height` | Height of the capsule. |

The host also reports the other two header controls, measured from the top and
left edges, and leaves a group undefined while that element is not shown:

| Variables | Element |
| --- | --- |
| `--link-miniapp-back-left`, `-top`, `-width`, `-height` | The ✕ / ‹ button. Undefined when hidden and in fullscreen. |
| `--link-miniapp-title-left`, `-top`, `-width`, `-height` | The capsule with the app icon and name. Undefined when hidden and in fullscreen. |

Round positions down and sizes up, so each rectangle covers its control. Touches
inside these rectangles always go to Link, whatever the page draws there.

`getInsets().controls` returns the capsule variables; they are 0 on older hosts.
`getHeaderLayout()` returns all three controls as `{ x, y, width, height }` from
the top left corner of the page, plus `free`: the gap in the header row between
the left controls (or the left safe area) and the capsule, with 8 px margins, or
null when it is narrower than 48 px or when the capsule sits in the camera band
(fullscreen portrait), where the notch interrupts the row. `onHeaderLayoutChange()`
follows `linkminiapp:insets` and window resizes. The
`--link-miniapp-header-height` keeps its meaning: the lowest point of host UI at
the top, never less than the top safe area. Every change of layout (rotation,
fullscreen on or off, compact header) updates all variables and dispatches
`linkminiapp:insets` in the same frame.

1. **App, portrait (phone).** As in 0.4.0: status bar, then a 58 pt header row
   with the left button, the title and the ⋯ | ⌄ capsule.
2. **App, landscape (phone).** The header is compact: one 44 pt row, 36 pt buttons,
   the title without the second line. The status bar is hidden, as iOS does in
   landscape. Header controls stay inside the left and right safe areas, away from
   the notch. The page pads left and right with the safe-area variables.
3. **Game, fullscreen, portrait.** The status bar and the Android navigation bar
   are hidden; an edge swipe shows them for a moment. The left button and the
   title are hidden; one small ⋯ | ⌄ capsule (32 pt high) stays in the top right
   corner. Where the top safe area is a notch or Dynamic Island band, the capsule
   sits in that band beside it, so it takes no space from the game; otherwise
   8 pt from the top edge. Close stays in the ⋯ menu: a stray tap in the corner
   only minimizes the game.
4. **Game, fullscreen, landscape.** Same capsule, 8 pt from the top edge and from
   the right safe area. No status bar. The game keeps only the capsule rectangle
   clear and uses the rest of the top row.
5. **Desktop.** Fullscreen compacts the header inside the Mini App area; it does
   not make the operating-system window fullscreen. Orientation has no effect.

In landscape the ⋯ menu does not fit in one column (about 11 rows on a screen
about 390 pt high). Show it as two columns: the page's own items on the left, the
Link items on the right, with 40 pt rows. Without own items, one column of Link
items.

The capsule is always visible and reachable: it is how the user closes and
minimizes a game. It does not fade or hide by itself.

System gestures in fullscreen:

- iOS: the status bar does not reappear in fullscreen. The home indicator auto-hides (`prefersHomeIndicatorAutoHidden`) and
  screen edges defer system gestures (`preferredScreenEdgesDeferringSystemGestures`
  = all edges), so a game swipe is not taken by the system on the first try. The
  client turns off its own edge-swipe Back in fullscreen; ⋯ and ⌄ stay.
- Android: immersive mode with transient bars on swipe
  (`BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE`). Transient bars lie over the game;
  while they are visible the capsule moves below the status bar and returns with
  them. The variables do not change for transient bars. System Back cannot be turned off;
  it keeps following `back_v1`, so a game should open its pause menu and return
  `true`.
- Desktop: Esc is not taken from a focused page; the page handles it itself.

### Touch, accessibility and motion

- Every host control has a touch area of at least 44 × 44 pt (iOS, desktop) or
  48 × 48 dp (Android), larger than the drawn control where needed: the 32 pt
  fullscreen capsule and the 36 pt compact buttons get invisible margins. The
  `controls`, `back` and `title` variables describe these touch areas.
- The backing of each control changes together with `icons`, so a wrong choice by
  the page never makes a button invisible. The fullscreen capsule backing is at
  least 72 % opaque: white icons keep a contrast of at least 6.5 : 1 over a white
  game background.
- Menu rows are at least 44 pt high in every orientation. When a landscape column
  does not fit the screen height, that column scrolls; the identity row (icon and
  name) heads the left column.
- Accessibility labels: «Назад», «Закрыть», «Ещё», «Свернуть». With the title
  hidden or in fullscreen, «Ещё» also names the app («Ещё, Hayrat»). The identity
  row in the menu is a heading. Own menu items are read by their titles.
- With a larger text size the header row and the menu rows grow and the variables
  change; titles that do not fit end with an ellipsis, never clipped.
- Desktop keyboard order: left button, title (opens About), ⋯, ⌄ or ✕.
- With Reduce Motion on, entering and leaving fullscreen, the compact header and
  orientation changes use a cross-fade or no animation instead of movement.

### Performance

- Update all variables in one stylesheet change and dispatch one
  `linkminiapp:insets` per change, not one per variable, and none when nothing
  changed. Compute the rectangles from the layout pass that draws the header; do
  not measure again for the page.
- The SDK reads the variables once per frame in `requestAnimationFrame` for all
  listeners, after the page's own resize handlers, so the browser recalculates
  styles once per frame. (Measured on a 4,000-element page: 21 ms per frame
  instead of 34 ms when the SDK read inside the event.)
- Apply at most one header state per frame. Parse and validate it off the main
  thread when the platform allows.
- Send `minimize` when minimizing starts, before the animation, so a game stops
  its sound at once. A minimized WebView stops drawing: Android `onPause()`, iOS
  out of the window, desktop hidden; JavaScript timers may keep running, so the
  page stops its own loops in `onMinimize`.

Orientation:

- `landscape` turns the Mini App screen to landscape and lets it follow the sensor
  between the two landscape sides; `portrait` keeps it upright; `auto` follows the
  device and the system rotation lock. A requested orientation applies even with
  the system rotation lock on, only to the Mini App screen and only while it is in
  front. Minimizing and closing return Link to its own orientation; restoring
  turns the screen back before `restore` is sent.
- Android: `requestedOrientation` of the Mini App activity (`SENSOR_LANDSCAPE`,
  `SENSOR_PORTRAIT`, `UNSPECIFIED`). iOS: `supportedInterfaceOrientations` of the
  Mini App view controller plus `requestGeometryUpdate`. On iPad split view and on
  desktop it is a hint the host may ignore.

### Events, host → page

```json
{"version":1,"type":"link-miniapp:header-event","document_id":"<document-uuid>","event_id":7,"event":"menu_item","item_id":"settings"}
{"version":1,"type":"link-miniapp:header-event","document_id":"<document-uuid>","event_id":8,"event":"minimize"}
{"version":1,"type":"link-miniapp:header-event","document_id":"<document-uuid>","event_id":9,"event":"restore"}
```

`event_id` is a strictly increasing positive safe integer per document, separate
from Back event IDs. The SDK drops repeated and older IDs, and a `menu_item` whose
item the page has since removed. No acknowledgement is sent: the page cannot delay
or cancel a minimize. Send `minimize` as soon as minimizing starts (⌄, the menu
or `minimize()`), before the animation, and `restore` when the app is visible
again. Moving Link itself
to the background is not a minimize; the page sees `visibilitychange` for that.

The SDK subscribes once after a successful `init()` when the adapter advertises
`header_v1` and has both methods. Teardown, bridge, origin, document or identity
replacement and `SDK.close()` stop the SDK side, including a packet not yet sent;
header calls then throw `ACCESS_REVOKED`. If `subscribeHeader` throws or
`setHeaderState` throws or rejects, the SDK turns off only the header for this
document: header calls throw `HEADER_NOT_SUPPORTED`, as on an older host, and
`init()`, `getUserInfo()` and Back keep working. `device_v1` behaves the same
with `DEVICE_NOT_SUPPORTED` when `subscribeDevice` throws.

[`test/header-host.mjs`](../test/header-host.mjs) is a synthetic host with these
checks. It is an executable contract example, not a client implementation.

### Pause, sound and closing events (header_v1)

```json
{"version":1,"type":"link-miniapp:header-event","document_id":"<uuid>","event_id":10,"event":"pause","reason":"overlay"}
{"version":1,"type":"link-miniapp:header-event","document_id":"<uuid>","event_id":11,"event":"resume"}
{"version":1,"type":"link-miniapp:header-event","document_id":"<uuid>","event_id":12,"event":"sound","muted":true}
{"version":1,"type":"link-miniapp:header-event","document_id":"<uuid>","event_id":13,"event":"closing","reason":"user"}
```

- `pause` / `resume`: the host keeps a set of reasons — `minimized`, `background`
  (Link left the screen), `locked`, `interrupted` (call, Siri, alarm, audio focus
  lost) and `overlay` (the ⋯ menu, a Link dialog or sheet, share). It
  sends `pause` with the reason that made the set non-empty and `resume` when the
  set is empty again; reason changes in between are not sent. Send `pause` before
  the overlay or animation appears. After `minimize` the host also sends `pause`.
- `sound`: with `sound_control: true` in the state, the host adds «Без звука» /
  «Включить звук» to the system group of the ⋯ menu, remembers the choice per app
  and user on the device, sends the remembered value right after `sound_control`
  turns on, and again on every toggle. The page mutes itself. On iOS, run Mini App
  WebViews in the `.ambient` audio session category, so the ring/silent switch
  silences them and the user's music keeps playing.
- `closing`: sent once before the app closes, with `user` (✕, the menu, Back that
  ended in close, ✕ on the minimized bar — after the confirmation if any),
  `evicted` (a fourth app needs room) or `revoked` (access withdrawn, sign-out,
  account switch). The host keeps the page running for 300 ms after sending, then
  tears it down. Not sent for `LinkMiniApp.close()`.

## Device extension (unreleased)

`device_v1` gives a page coarse device state so it can save power and keep a game
smooth. The bridge has `capabilities` including `device_v1`, the same `documentId`
and `subscribeDevice(listener): () => void`. The host sends the whole state once on
subscription and again on every change:

```json
{"version":1,"type":"link-miniapp:device","document_id":"<uuid>","event_id":1,
 "state":{"platform":"ios","link_version":"7.1.0","performance":"high","thermal":"nominal","power_saving":false,"battery_low":false}}
```

| Field | Values | Source |
| --- | --- | --- |
| `platform` | `ios`, `android`, `desktop` | The client. |
| `link_version` | `^[0-9A-Za-z.+-]{1,32}$` | The client version. |
| `performance` | `low`, `mid`, `high` | The client's estimate from memory and processor cores, fixed per device. |
| `thermal` | `nominal`, `fair`, `serious`, `critical` | iOS `ProcessInfo.thermalState`; Android `PowerManager` thermal status (API 29+, `nominal` before); macOS `ProcessInfo.thermalState`; Windows `nominal`. |
| `power_saving` | boolean | iOS Low Power Mode; Android Battery Saver; desktop OS battery saver. |
| `battery_low` | boolean | At most 20 % and not charging. |

Never send a battery percentage, a device model, a name or any other value that
helps identify a device. All values need no runtime permission on any platform.
Do not send more than one state per second; coalesce. The SDK ignores malformed
and repeated states and exposes them only after `init()` in the authorized main
document. `supports(name)` in the SDK is true only for an extension the host
provides completely.

## Share extension (unreleased)

`share_v1` lets a page ask Link to share a link to the same Mini App in Link
chats. The page never names a URL or a chat. Link builds the link, shows its
own chat picker, and the user sends the message. The page learns only whether
it was sent.

Advertise `share_v1` in `capabilities` only when the READY launch has
`web.share_link: true` (the app enabled sharing in Console and passed review for
Live). Without the capability the SDK throws `SHARE_NOT_SUPPORTED` and sends
nothing. The flag cannot change during a document: a configuration change
already closes the bridge.

Request:

```json
{
  "version": 1,
  "request_id": "<request-uuid>",
  "method": "share",
  "params": { "start": "room.7f3a", "text": "Join my room" }
}
```

Both fields are optional; `params` may be `{}`, which shares the app itself.
No other key is allowed.

| Field | Rule |
| --- | --- |
| `start` | `^[A-Za-z0-9._-]{1,256}$`, the same as `start_param` of a launch |
| `text` | 1–500 Unicode code points, not only whitespace, well-formed UTF-16; no C0/C1 controls except tab and line feed, no bidi embeddings, overrides or isolates (U+202A–U+202E, U+2066–U+2069) |

Response:

```json
{ "version": 1, "request_id": "<same-request-uuid>", "result": { "outcome": "shared" } }
```

`outcome` is `shared` when the message went to at least one chat and
`cancelled` otherwise. Never return the chats, recipients, their number or
anything else; the SDK drops other fields anyway. Errors use `error.code`:
`INVALID_SHARE_REQUEST`, `SHARE_IN_PROGRESS`, `USER_GESTURE_REQUIRED`,
`SHARE_NOT_SUPPORTED`, `ACCESS_REVOKED`.

### What the host does

1. Validate `params` again by the table above. Never trust the SDK's checks.
2. Build the link itself from the launch, never from page data:
   `https://linkm.me/miniapps/<slug>` for Live, with `?env=test` for Test, plus
   `start` when present (`?start=` or `&start=`). `<slug>` is the slug of the
   app that owns this document.
3. Open the same chat picker as the ⋯ menu item "Share". Show the text in an
   editable field above the link preview; the user can change or delete it.
   Sending is the user's tap in the picker; the page never sends on its own.
4. Send an ordinary message: the text, a line feed, the link. The recipient's
   client draws the usual Mini App link card from `GET /mini-apps/info`, and a
   tap opens the app with `start` (launch source `LAUNCH_SOURCE_LINK`).
5. Resolve with `shared` or `cancelled` when the picker closes.

Rules:

- Only the authorized main document of a visible, front Mini App. One picker
  per document: answer a second request with `SHARE_IN_PROGRESS`.
- Require a recent user tap in the page, as for `pay`, and answer
  `USER_GESTURE_REQUIRED` otherwise. Opening the picker on page load or on a
  timer is not allowed.
- While the picker is open the page is covered: send `pause` with reason
  `overlay` (header_v1) and `resume` when it closes.
- Navigation, closing, revocation or another account discards the result;
  close the picker. Emit `linkminiapp:closed` if the document stays alive.
- The SDK waits up to 10 minutes. After that it reports `HOST_TIMEOUT`; the
  host closes the picker at the same time or answers the next request with
  `SHARE_IN_PROGRESS` while it is still open.
