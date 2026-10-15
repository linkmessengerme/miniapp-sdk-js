// Optional adapter for an explicitly trusted browser host. Native SDK behavior
// is unchanged. Only a document-bound MessagePort carries scoped credentials.
export function installBrowserHost(scope = globalThis, { hostOrigin } = {}) {
  if (scope.__LinkMiniAppHost || !scope.opener || scope.top !== scope) return false;
  const origin = new URL(hostOrigin);
  if (origin.origin !== hostOrigin || origin.username || origin.password ||
      !(origin.protocol === 'https:' || (origin.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)))) throw Error('INVALID_HOST_ORIGIN');
  const opener = scope.opener, nonce = scope.crypto.randomUUID(), requests = new Map();
  let port, closed = false, handshakeTimer;
  let resolveConnection, rejectConnection;
  const connection = new Promise((resolve, reject) => { resolveConnection = resolve; rejectConnection = reject; });
  connection.catch(() => {});
  function stop() {
    if (closed) return;
    closed = true; clearTimeout(handshakeTimer);
    scope.removeEventListener('message', connect); port?.close();
    rejectConnection(Error('ACCESS_REVOKED'));
    for (const { reject, timer } of requests.values()) { clearTimeout(timer); reject(Error('ACCESS_REVOKED')); }
    requests.clear();
    scope.dispatchEvent(new scope.CustomEvent('linkminiapp:closed'));
  }
  function connect(event) {
    if (closed || port || event.source !== opener || event.origin !== hostOrigin || event.data?.type !== 'link-miniapp:connected' ||
        event.data.version !== 1 || event.data.nonce !== nonce || event.ports?.length !== 1) return;
    clearTimeout(handshakeTimer); scope.removeEventListener('message', connect);
    port = event.ports[0];
    port.onmessage = ({ data }) => {
      if (closed) return;
      if (data?.type === 'link-miniapp:revoked') { stop(); return; }
      const pending = requests.get(data?.request_id);
      if (!pending || data.version !== 1) return;
      requests.delete(data.request_id); clearTimeout(pending.timer);
      if (closed) pending.reject(Error('ACCESS_REVOKED')); else pending.resolve(data);
    };
    port.onmessageerror = stop; port.start(); resolveConnection();
  }
  scope.addEventListener('message', connect);
  scope.addEventListener('pagehide', stop, { once: true });
  scope.addEventListener('pageshow', event => { if (event.persisted) stop(); });
  handshakeTimer = setTimeout(stop, 8000);
  Object.defineProperty(scope, '__LinkMiniAppHost', { configurable: false, value: Object.freeze({
    async request(packet) {
      if (closed || packet?.version !== 1 || !['init', 'close'].includes(packet.method) || typeof packet.request_id !== 'string') throw Error('ACCESS_REVOKED');
      await connection;
      if (closed) throw Error('ACCESS_REVOKED');
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { requests.delete(packet.request_id); reject(Error('HOST_TIMEOUT')); }, 8000);
        requests.set(packet.request_id, { resolve, reject, timer });
        port.postMessage({ version: 1, request_id: packet.request_id, method: packet.method });
      });
    }
  }) });
  opener.postMessage({ type: 'link-miniapp:hello', version: 1, nonce }, hostOrigin);
  return true;
}
