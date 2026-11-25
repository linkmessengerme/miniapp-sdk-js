# Changelog

## 0.6.0 — 2026-11-25

- `share_v1`: `share({ start, text })` opens Link's chat picker with a link to
  the same app, `https://linkm.me/miniapps/<slug>?start=<start>`, and an
  editable text. Returns `{ outcome: 'shared' | 'cancelled' }` and nothing
  about the recipients. Requires a user gesture, one picker at a time, and the
  app's sharing setting in Console; otherwise `USER_GESTURE_REQUIRED`,
  `SHARE_IN_PROGRESS` or `SHARE_NOT_SUPPORTED`. Invalid options fail with
  `INVALID_SHARE_REQUEST` before anything is sent. The browser adapter forwards
  `share` when the host advertises `share_v1`.

## 0.5.1 — 2026-11-24

- A failed header or device transport turns off only that extension for the
  page: its calls throw `HEADER_NOT_SUPPORTED` / `DEVICE_NOT_SUPPORTED`, as on an
  older client, and `supports()` returns false for it. In 0.5.0 they threw
  `ACCESS_REVOKED`, which a page could take for the end of the visit.
  `ACCESS_REVOKED` is now reserved for the end of the visit (closed, revoked,
  navigated away, another identity).

## 0.5.0 — 2026-11-24

- `header_v1`: after `init()`, a page can change the Link header on clients that
  advertise it. `setBackButton()` picks the left button (`auto`, `back`, `close`,
  `hidden`); `setCloseConfirmation()` makes Link ask before the user closes the
  app; `setMenuItems()` adds up to five own items before the Link items of the ⋯
  menu, picked through `onMenuItem()`; `onMinimize()`, `onRestore()` and
  `minimize()` handle the ⌄ button; `setHeaderStyle({ icons })` sets the colour
  of the header buttons and `setHeaderStyle({ title: 'hidden' })` removes the
  title capsule; `setFullscreen()` shrinks the header to a small corner
  capsule for games; `setOrientation()` asks for landscape or portrait.
- `getInsets().controls` returns the rectangle of the ⋯ capsule, so a game in
  fullscreen keeps only that corner clear. 0 on older clients.
- `getHeaderLayout()` and `onHeaderLayoutChange()` return the rectangles of the
  left button, the title and the capsule, and the free gap in the header row, so
  a page can line up its own controls with the Link header. Null on older clients.
- The page cannot remove closing, minimizing or the Link menu items, and cannot
  set the title. On older clients every call throws `HEADER_NOT_SUPPORTED` and
  the header behaves as before.
- `onInsetsChange()` listeners now run once per frame in `requestAnimationFrame`
  (at the end of the task where it is unavailable), sharing one read of the
  variables with `onHeaderLayoutChange()`. A throwing listener no longer stops
  the others.
- `onPause()` / `onResume()` with the reason (minimized, background, locked,
  interrupted, overlay), `isPaused()`; `setSoundControl()` adds a Link mute item
  to the ⋯ menu, reported with `onSoundChange()` / `isMuted()`; `onClosing()` gives
  the page about 300 ms to save before the app closes.
- `device_v1`: `getDevice()` / `onDeviceChange()` return coarse device state —
  platform, Link version, performance class, thermal state, power saving and low
  battery, without a battery percentage or anything identifying. `supports(name)`
  tells whether an extension is available after `init()`.
- New error codes: `DEVICE_NOT_SUPPORTED`, `INVALID_DEVICE_LISTENER`, `HEADER_NOT_SUPPORTED`, `INVALID_HEADER_OPTION`,
  `INVALID_MENU_ITEMS`, `INVALID_HEADER_LISTENER`, `INVALID_LAYOUT_LISTENER`, `MINIMIZE_NOT_AVAILABLE`.
- `docs/host-bridge.md` describes the packets and what clients must enforce.
  No Link client implements `header_v1` yet.

## 0.4.0 — 2026-11-22

- Link draws its header as a transparent overlay above every Mini App. The new
  `@link-apps/miniapp/ui.css` provides `link-miniapp-page` and
  `link-miniapp-header`, which keep content clear of the header and the system
  bars on phones and desktop.
- `getInsets()` and `onInsetsChange()` return the header height and the safe
  areas in CSS pixels. They work without `init()` and return 0 outside Link and
  on older hosts.
- `@link-apps/miniapp/preview` draws a stand-in for the Link header in an
  ordinary browser for development.
- `docs/host-bridge.md` describes what Link clients provide: an edge-to-edge
  WebView, a transparent header and five CSS variables set at document start.

## 0.3.0 — 2026-11-18

- `init()` returns the optional `startParam`: the `start` value of the link that
  opened the Mini App (`https://linkm.me/miniapps/<slug>?start=<value>`), so a
  link, a message or a push can open a particular screen. Only 1 to 256 Latin
  letters, digits and `._-` reach the application; the value is untrusted input.
  Hosts released earlier simply omit it.

## 0.2.0 — 2026-10-29

- Added public `onBack(handler)` with unsubscribe, explicit handled/root results,
  cancellation signals and a document-wide dispatcher shared by SDK instances.
- Added `back_v1` document/event-bound event acknowledgements, replay protection,
  bounded waits and safe keep-open behavior on errors, timeout or late results.
- Added native-shaped and MessagePort Back fixtures; documented exact Android/iOS
  integration requirements and checkout priority. Device support is unverified.
- Extended the optional browser bridge with authenticated host capabilities and
  the private SDK's `pay` packet, limited to a checkout-session UUID.
- Added a separate 30-minute payment wait and invalidation on close/revocation.
- Documented native payment, Back and close requirements. The public SDK does
  not expose `pay`; native/device integration remains separately verified.
- Development requires Node.js 24.22.1 or later.

## 0.1.0 — 2026-10-22

- `init()` and `close()` for the Link Mini Apps host bridge v1.
- `getUserInfo()` obtains the current scoped access token, validates the subject,
  and exposes only fields allowed by granted permissions.
- Expiring tokens are replaced by a new launch of the same application;
  `launchId` may change during a visit without closing the browser adapter.
- Optional browser host adapter with origin and nonce validation, a
  document-bound MessagePort, and revocation handling.
- Revocation invalidates in-flight UserInfo responses.
- Runtime validation of host response fields and typed errors that discard
  unexpected adapter messages and causes.
- ESM exports, TypeScript declarations, integration documentation, a server
  verification example, and package installation checks.

Authenticated production-browser `getUserInfo()` verification is deferred.
Native host implementations and device testing are separate from this JavaScript package.
