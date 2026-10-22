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
3. Only `init` and `close` packets use the port, following [bridge v1](host-bridge.md).
   Broadcast window messages must not contain credentials or profile data.
4. Launches are not extended. On `init`, the host replaces an expiring launch
   with a new launch of the same app. The `launch_id` changes; the channel remains.
5. `link-miniapp:revoked`, `pagehide`, or restoration from the back-forward cache
   ends the channel. A new document requires a new handshake.

Bind every bridge request to the actual document and authorized launch.
Native hosts require their own origin enforcement and device verification.
