# Changelog

## 0.1.0 — release candidate

- `init()` and `close()` for the Link Mini Apps host bridge v1.
- `getUserInfo()` uses the current scoped Mini App access token, validates the
  subject and exposes only fields allowed by the granted scopes.
- Optional `@link-apps/miniapp/browser-host` adapter for a trusted popup host,
  with origin/nonce checks, a document-bound MessagePort and revocation handling.
- Adapter revocation invalidates in-flight UserInfo responses in the SDK.
- ESM exports, TypeScript declarations, standalone integration documentation,
  package installation checks.

This version has not been published to npm. Android/iOS host implementations
and device testing are separate from this JavaScript package.
