// Optional adapter for an explicitly trusted browser host. Native SDK behavior
// is unchanged. Only a document-bound MessagePort carries scoped credentials.
import { BACK_CAPABILITY, isBackEvent, isBackAck } from './back.js';

const PAYMENTS_CAPABILITY = 'payments_v1';
const CHECKOUT_TIMEOUT_MS = 30 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function installBrowserHost(scope = globalThis, { hostOrigin } = {}) {
  if (scope.__LinkMiniAppHost || !scope.opener || scope.top !== scope) return false;
  const origin = new URL(hostOrigin);
  if (origin.origin !== hostOrigin || origin.username || origin.password ||
      !(origin.protocol === 'https:' || (origin.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)))) throw Error('INVALID_HOST_ORIGIN');
  const opener = scope.opener, nonce = scope.crypto.randomUUID(), requests = new Map();
  let port, closed = false, handshakeTimer, backListener, capabilities = Object.freeze([]);
  let resolveConnection, rejectConnection;
  const connection = new Promise((resolve, reject) => { resolveConnection = resolve; rejectConnection = reject; });
  connection.catch(() => {});
  function stop() {
    if (closed) return;
    closed = true; clearTimeout(handshakeTimer);
    backListener = undefined;
    scope.removeEventListener('message', connect); port?.close();
    rejectConnection(Error('ACCESS_REVOKED'));
    for (const { reject, timer } of requests.values()) { clearTimeout(timer); reject(Error('ACCESS_REVOKED')); }
    requests.clear();
    scope.dispatchEvent(new scope.CustomEvent('linkminiapp:closed'));
  }
  function connect(event) {
    if (closed || port || event.source !== opener || event.origin !== hostOrigin || event.data?.type !== 'link-miniapp:connected' ||
        event.data.version !== 1 || event.data.nonce !== nonce || event.ports?.length !== 1) return;
    const supported = event.data.capabilities ?? [];
    if (!Array.isArray(supported) || supported.length > 32 ||
        !supported.every(value => typeof value === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(value))) { stop(); return; }
    capabilities = Object.freeze([...new Set(supported)]);
    clearTimeout(handshakeTimer); scope.removeEventListener('message', connect);
    port = event.ports[0];
    port.onmessage = ({ data }) => {
      if (closed) return;
      if (data?.type === 'link-miniapp:revoked') { stop(); return; }
      if (data?.type === 'link-miniapp:back') {
        if (capabilities.includes(BACK_CAPABILITY) && isBackEvent(data, nonce)) backListener?.(data);
        return;
      }
      const pending = requests.get(data?.request_id);
      if (!pending || data.version !== 1) return;
      requests.delete(data.request_id); clearTimeout(pending.timer);
      if (closed) pending.reject(Error('ACCESS_REVOKED')); else pending.resolve(data);
      if (pending.method === 'close') stop();
    };
    port.onmessageerror = stop; port.start(); resolveConnection();
  }
  scope.addEventListener('message', connect);
  scope.addEventListener('pagehide', stop, { once: true });
  scope.addEventListener('pageshow', event => { if (event.persisted) stop(); });
  handshakeTimer = setTimeout(stop, 8000);
  Object.defineProperty(scope, '__LinkMiniAppHost', { configurable: false, value: Object.freeze({
    get capabilities() { return capabilities; },
    documentId: nonce,
    subscribeBack(listener) {
      if (closed) throw Error('ACCESS_REVOKED');
      if (!port || !capabilities.includes(BACK_CAPABILITY)) throw Error('BACK_NOT_SUPPORTED');
      if (typeof listener !== 'function' || backListener) throw Error('INVALID_BACK_HANDLER');
      backListener = listener;
      return () => { if (backListener === listener) backListener = undefined; };
    },
    ackBack(packet) {
      if (closed) throw Error('ACCESS_REVOKED');
      if (!port || !capabilities.includes(BACK_CAPABILITY) || !isBackAck(packet, nonce)) throw Error('INVALID_BACK_ACK');
      port.postMessage({ version: 1, type: 'link-miniapp:back-ack', document_id: nonce,
        event_id: packet.event_id, action: packet.action });
    },
    async request(packet) {
      if (closed || packet?.version !== 1 || !['init', 'close', 'pay'].includes(packet.method) || typeof packet.request_id !== 'string') throw Error('ACCESS_REVOKED');
      const forwarded = { version: 1, request_id: packet.request_id, method: packet.method };
      if (packet.method === 'pay') {
        const params = packet.params;
        if (!params || typeof params !== 'object' || Array.isArray(params) || Object.keys(params).length !== 1 || !Object.hasOwn(params, 'checkout_session_id') ||
            typeof params.checkout_session_id !== 'string' || !UUID.test(params.checkout_session_id) ||
            params.checkout_session_id === '00000000-0000-0000-0000-000000000000') throw Error('INVALID_PAYMENT_REQUEST');
        forwarded.params = { checkout_session_id: params.checkout_session_id };
      }
      await connection;
      if (closed) throw Error('ACCESS_REVOKED');
      if (forwarded.method === 'pay' && !capabilities.includes(PAYMENTS_CAPABILITY)) throw Error('PAYMENTS_NOT_SUPPORTED');
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { requests.delete(forwarded.request_id); reject(Error('HOST_TIMEOUT')); }, forwarded.method === 'pay' ? CHECKOUT_TIMEOUT_MS : 8000);
        requests.set(forwarded.request_id, { resolve, reject, timer, method: forwarded.method });
        port.postMessage(forwarded);
      });
    }
  }) });
  opener.postMessage({ type: 'link-miniapp:hello', version: 1, nonce }, hostOrigin);
  return true;
}
