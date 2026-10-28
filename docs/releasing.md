# Release procedure

The initial release is `@link-apps/miniapp@0.1.0`. npm publication is manual.
Run checks and create candidate archives locally. GitHub Actions is currently
disabled. See [verification status](verification.md).

## 0.2.0: Back and payment bridge

Version 0.2.0 adds `onBack`, `back_v1` and the browser payment bridge to the
published 0.1.0 baseline. Do not overwrite that release. Publish 0.2.0 first, then update
the internal SDK's exact public dependency and lockfile to it before its Git
release. Until then internal `onBack` deliberately throws `BACK_NOT_SUPPORTED`
on its declared 0.1.0 core; native `pay` remains compatible with that core.

Run both packages' `npm run check` and, from the internal repository,
`npm run test:package -- ../link-miniapp-js` to check two real local archives with
Back/checkout over MessagePort. These commands do not publish, tag or change
dependencies. The local pair's temporary archive installation is not proof that
the declared registry dependency already contains Back. Native client acceptance
is a separate prerequisite for advertising the capabilities in released clients.

## Verify the candidate

```sh
npm ci --ignore-scripts
npm run check
mkdir -p dist
npm pack --pack-destination dist
```

The checks cover SDK and adapter behavior, token verification, TypeScript, the
exact archive contents, and installation in an isolated consumer project.
Runtime files are JavaScript and do not require transpilation.
`prepublishOnly` automatically runs `npm run check` before publication.

Before release, review source, metadata, documentation, examples, and artifacts.
Use `Link Messenger <dev@linkmessenger.me>` for repository-local commit identity.
This setting does not change existing authors or commits created by GitHub's web UI.
Do not include local tooling, environment files, credentials, or user data.
Review reachable Git history separately before making any repository public;
a clean working tree or npm archive does not sanitize repository history.

## Browser verification

Use the candidate SDK in a real browser document on a registered Mini App origin.
Obtain a fresh launch through an authenticated Link host and call `getUserInfo()`.
Use the browser's actual fetch implementation with normal CORS enforcement.
A Node request, a supplied Origin header, or an API mock does not establish that
the production browser integration works.

Verify successful UserInfo, matching subject, granted fields only, absence of
phone without its scope, `Cache-Control: no-store`, and one valid CORS origin.
Also verify new tokens after expiry and rejection after revocation. Record only
status codes, field names, and boolean outcomes; do not record profile values,
phone numbers, subjects, ID tokens, or access tokens.

## Publish

1. Confirm successful local checks for the release revision and record the browser
   verification status. The `0.1.0` release proceeds with authenticated
   production-browser UserInfo verification explicitly deferred; it must not be
   reported as a successful production integration check.
2. Review the public source snapshot and make the documentation available.
3. Set the release date in the changelog and update unpublished-package notices.
4. Check `npm whoami` and publishing rights for `@link-apps`. Use 2FA or trusted
   publishing; keep credentials out of the repository.
5. Run `npm run check` and `npm publish --dry-run`; review the archive contents.
6. Publish from the verified clean checkout with `npm publish --access public`.
7. Verify `npm view @link-apps/miniapp@0.1.0 dist.integrity`, tag the release
   revision as `v0.1.0`, and create the GitHub release.
8. Install the registry package in a clean consumer project and verify both
   exports and TypeScript declarations.

Native host implementations and device E2E remain separate verification tasks.
