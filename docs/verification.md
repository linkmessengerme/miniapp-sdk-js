# Release candidate verification

Candidate: `@link-apps/miniapp@0.1.0`. Checked on 2026-10-22.

| Check | Result |
| --- | --- |
| Node.js 20.19.0 unit tests | 23 passed |
| TypeScript and installed-package consumer types | Passed |
| Tarball installation and both ESM exports | Passed; 8 package files |
| Chrome 153, actual cross-origin browser fetch with synthetic fixtures | 9 checks passed |
| Chrome 153, after host validation and error handling changes | 6 checks passed |
| Authenticated production-browser UserInfo | Pending; deferred |
| GitHub Actions | Disabled; release checks run locally |
| npm publication | Not performed |

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

The candidate is not published. Local checks and production-browser results
must be confirmed before publication; see the [release procedure](releasing.md).
