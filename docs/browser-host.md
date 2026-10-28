# Browser host

`@link-apps/miniapp/browser-host` connects a Mini App opened in a separate browser
window to a trusted host. Native hosts provide the same SDK contract themselves.
The package does not include an application-specific host or authentication UI.

## Next.js

Connect after mounting a client component:

```tsx
'use client';

import { useEffect, useState } from 'react';
import type { MiniAppContext } from '@link-apps/miniapp';

export function LinkGate() {
  const [context, setContext] = useState<MiniAppContext | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const closed = () => { setContext(null); setError('The session has ended'); };
    window.addEventListener('linkminiapp:closed', closed);
    void (async () => {
      const [{ default: sdk }, { installBrowserHost }] = await Promise.all([
        import('@link-apps/miniapp'),
        import('@link-apps/miniapp/browser-host'),
      ]);
      if (!active) return;
      const hostOrigin = process.env.NEXT_PUBLIC_LINK_WEB_HOST_ORIGIN;
      if (hostOrigin) installBrowserHost(window, { hostOrigin });
      const next = await sdk.init();
      if (active) setContext(next);
    })().catch(() => { if (active) setError('Open this application from Link'); });
    return () => { active = false; window.removeEventListener('linkminiapp:closed', closed); };
  }, []);

  if (error) return <p>{error}</p>;
  if (!context) return <p>Connecting to Link...</p>;
  return <p>Hello, {context.user.name}</p>;
}
```

`NEXT_PUBLIC_LINK_WEB_HOST_ORIGIN` is a trusted build-time setting, such as
`http://localhost:3008`. Changing it requires rebuilding the frontend. Never
accept the host origin from query parameters, window messages, or storage.
Your backend must verify the ID token before creating its own session.

When migrating from a bundled SDK copy, replace both the SDK and adapter imports.
Only one copy may install `window.LinkMiniApp` in a document.

`installBrowserHost(window, { hostOrigin })` returns `true` if it starts a
handshake and `false` when a bridge already exists, the opener is missing, or
the document is an iframe. `true` does not mean authentication has completed;
`init()` waits for the connection. Invalid host origins are rejected.
The host must use HTTPS or HTTP loopback with no path.

Keep the parent window open. Do not use `noopener` or a COOP policy that breaks
the opener relationship. Live Mini App documents still require HTTPS.

## Protocol

1. The Mini App sends its opener `link-miniapp:hello` with `version: 1` and a
   random `nonce`, targeting the exact configured `hostOrigin`.
2. The host validates the Mini App's origin and window identity, creates a
   MessageChannel, and replies with `link-miniapp:connected`, the same nonce,
   and one transferred MessagePort.
3. `init` and `close` packets use the port, following [bridge v1](host-bridge.md).
   Optional `capabilities: ['payments_v1', 'back_v1']` in the authenticated connected
   message enable the implemented extensions. Advertise each independently;
   old hosts omit them.
   Broadcast window messages must not contain credentials or profile data.
4. Launches are not extended. On `init`, the host replaces an expiring launch
   with a new launch of the same app. The `launch_id` changes; the channel remains.
5. `link-miniapp:revoked`, `pagehide`, or restoration from the back-forward cache
   ends the channel. A new document requires a new handshake.

Bind every bridge request to the actual document and authorized launch.
Native hosts require their own origin enforcement and device verification.

## Back-capable hosts (unreleased)

With `back_v1`, the adapter exposes `documentId`, `subscribeBack` and `ackBack`.
The document ID is the **hello nonce** from this handshake. Send
`{ version: 1, type: 'link-miniapp:back', document_id: nonce, event_id: 1 }` on
the same transferred port. Increase the integer ID for each new gesture;
retries reuse the ID. Receive
`{ version: 1, type: 'link-miniapp:back-ack', document_id: nonce, event_id: 1,
action: 'handled' | 'close' | 'ignored' }` on that port.

The SDK subscribes after `init()`; applications then register `onBack` handlers.
The adapter ignores Back on window messages, on another document's port/ID,
or without the authenticated capability. It forwards only ack envelope fields.
No `back_ack` request/response pair is created: ack is a one-way event packet,
separate from normal `request_id` responses.

The trusted opener implements the [complete host state machine](host-bridge.md#back-extension-unreleased):
one pending event, coalesced taps, at most 1500 ms to receive the matching ack,
ignore stale answers, preserve the screen on timeout/error and close only on
`action: 'close'`. Closing emits `link-miniapp:revoked` on the port and ends the
visit. Checkout Back first dismisses checkout with `dismissed`; it sends no Back
event to the Mini App. Serialize checkout UI transitions with pending Back.

Use [`test/back-host.mjs`](../test/back-host.mjs) and the MessagePort cases in
[`test/browser-host.test.mjs`](../test/browser-host.test.mjs) as the test host.
They use synthetic launch data and do not provide an authentication or payment UI.
For Android/iOS, implement the equivalent native adapter and validate on devices.

## Payment-capable hosts (unreleased)

The adapter exposes a frozen copy of the authenticated handshake's capabilities
through `window.__LinkMiniAppHost.capabilities`. It never infers payment support
from URLs, page options or arbitrary window messages. The public SDK still has
no `pay()` method; the internal SDK supplies it.

For `pay`, the adapter forwards only `version`, `request_id`, `method` and
`params: { checkout_session_id }` over the same document-bound MessagePort.
Unknown payment parameters are rejected, including price and identity fields.
Without the advertised capability it returns `PAYMENTS_NOT_SUPPORTED`.

Checkout has a 30-minute wait instead of the ordinary 8-second request timeout.
Page teardown, revocation, or acknowledgment of `close` rejects pending checkout
requests and closes the channel. A timeout never confirms failure or cancels an
order. The trusted opener must implement the full
[payment and Back/close contract](host-bridge.md#payments-extension-unreleased),
including user consent and authorization. This adapter does not supply a payment
UI, OTP form or native host implementation.
