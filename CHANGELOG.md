# Changelog

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
