# Release verification

## Unreleased Back and payment bridge — 2026-10-28

Node.js 24.22.1 verification:

| Check | Result |
| --- | --- |
| Public SDK/adapter tests | 54 passed |
| Internal payment/lifecycle/old-core tests | 21 passed |
| Both installed local archives, Back/checkout over real Node MessagePort | 6 integration tests passed |
| TypeScript (including examples and packed consumer declarations) | Passed for both packages |
| Public tarball installation | Passed; 9 package files, including the Back dispatcher |
| Internal tarball with actual installed public 0.1.0 | Passed; pay works, onBack throws BACK_NOT_SUPPORTED |

Run `npm run check` in each repository and
`npm run test:package -- ../link-miniapp-js` in the internal repository.

Back coverage includes modal → router → root, no handler, stack/unsubscribe,
cross-instance dispatch, duplicate/out-of-order events, malformed/foreign packets,
SDK/host deadlines (including delayed timer callbacks), errors and late results,
close from inside a handler, navigation, revocation, identity changes and launch
renewal. Packed pair tests verify checkout dismissal precedes app Back, preserving
the payment state, and cancellation of simultaneous Back/pay waits on teardown.

The protocol and native acceptance requirements are in
[host-bridge.md](host-bridge.md#back-extension-unreleased). The executable synthetic
host is [`test/back-host.mjs`](../test/back-host.mjs).

No tag or package was published. These local fixtures do not verify Android/iOS
host support, native Back navigation or a real Test purchase. These Back tests ran
in Node with synthetic fixtures, not in an Android/iOS or production browser
build. Those checks belong to the client team; hosts must not advertise `back_v1`
or `payments_v1` before implementing the respective contract. Public 0.1.0 does
not contain Back; the [public-first release dependency](releasing.md#unreleased-back-and-payment-bridge)
is still pending. Both working-tree package versions remain 0.1.0.

## Published 0.1.0 baseline

Package: `@link-apps/miniapp@0.1.0`. Checked on 2026-10-22.

| Check | Result |
| --- | --- |
| Node.js 20.19.0 unit tests | 23 passed |
| TypeScript and installed-package consumer types | Passed |
| Tarball installation and both ESM exports | Passed; 8 package files |
| Chrome 153, actual cross-origin browser fetch with synthetic fixtures | 9 checks passed |
| Chrome 153, after host validation and error handling changes | 6 checks passed |
| Authenticated production-browser UserInfo | Pending; deferred |
| GitHub Actions | Disabled; release checks run locally |
| npm package | [Registry metadata for 0.1.0](https://registry.npmjs.org/@link-apps/miniapp/0.1.0) |

The 23 tests cover the SDK, browser adapter, server verifier, scope filtering,
expiry, revocation, malformed responses, and sanitized host errors. Application-specific host tooling
and its tests have been removed; these are not failures or skipped SDK tests.

The browser fixture checks cover profile and granted-phone mapping, withholding
ungranted fields, token reissue, subject mismatch, readable authorization errors,
missing and duplicate CORS rejection, close behavior, actual OPTIONS/GET requests,
and omission of cookies. Browser security was not disabled. These checks use
synthetic identities and API responses, not an authenticated production account.

After strengthening host validation, six additional browser checks passed:
actual cross-origin UserInfo, malformed JSON, sanitized host exceptions, invalid
identity/profile types, typed revocation, and recovery with a valid new launch.
The browser sent real OPTIONS and GET requests with a bearer and no cookies.

An earlier public production JWKS check failed in Chrome because the response
contained two `Access-Control-Allow-Origin` headers. Follow-up HTTP probes on
2026-10-22 returned JWKS `200` with one Allow-Origin header and UserInfo preflight
`204`. Authenticated production-browser verification with a fresh launch and a
registered origin remains pending. A successful HTTP probe or local fixture is
not proof of successful production-browser UserInfo.

Publication of `0.1.0` proceeds with authenticated production-browser UserInfo
verification explicitly deferred. Local and synthetic browser checks do not
certify the production integration; see the [release procedure](releasing.md).
