# Changelog

## 0.1.0 — release candidate

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

This version has not been published to npm. Native host implementations and
device testing are separate from this JavaScript package.
