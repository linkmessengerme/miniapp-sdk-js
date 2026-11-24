// device_v1: coarse device state from the Link client, so a page can save power
// and keep a game smooth (see docs/host-bridge.md). Values are deliberately coarse:
// no battery percentage, no model name, nothing that identifies a device across
// sites. Only an authorized main document after init() receives them.
import { validDocumentId } from './back.js';

export const DEVICE_CAPABILITY = 'device_v1';
export const PLATFORMS = Object.freeze(['ios', 'android', 'desktop']);
export const PERFORMANCE_CLASSES = Object.freeze(['low', 'mid', 'high']);
export const THERMAL_STATES = Object.freeze(['nominal', 'fair', 'serious', 'critical']);
const VERSION = /^[0-9A-Za-z.+-]{1,32}$/;
const documents = new WeakMap();

// Returns a frozen camelCase copy of a valid host state, or null.
export function deviceState(state) {
  if (state === null || typeof state !== 'object' || Array.isArray(state)) return null;
  const { platform, link_version: version, performance, thermal, power_saving: powerSaving, battery_low: batteryLow } = state;
  if (!PLATFORMS.includes(platform) || typeof version !== 'string' || !VERSION.test(version) ||
      !PERFORMANCE_CLASSES.includes(performance) || !THERMAL_STATES.includes(thermal) ||
      typeof powerSaving !== 'boolean' || typeof batteryLow !== 'boolean') return null;
  return Object.freeze({ platform, linkVersion: version, performance, thermal, powerSaving, batteryLow });
}

export function documentDevice(scope, failure) {
  if (documents.has(scope)) return documents.get(scope);
  let bridge, documentId, origin, identity, detach, current = null, lastEvent = 0, stopped = false;
  const listeners = new Set();
  const sameDocument = () => !stopped && scope.__LinkMiniAppHost === bridge &&
    bridge.documentId === documentId && scope.location?.origin === origin &&
    (!('top' in scope) || scope.top === scope);

  function stop() {
    if (stopped) return;
    stopped = true; current = null;
    listeners.clear();
    try { detach?.(); } catch { /* The host is already being torn down. */ }
  }
  function report(error) {
    if (typeof scope.reportError === 'function') { try { scope.reportError(error); return; } catch { /* fall through */ } }
    setTimeout(() => { throw error; });
  }
  // The host sends the full state once on subscription and again on every change.
  function receive(packet) {
    if (!sameDocument()) { stop(); return; }
    if (packet?.version !== 1 || packet.type !== 'link-miniapp:device' || packet.document_id !== documentId ||
        !Number.isSafeInteger(packet.event_id) || packet.event_id <= lastEvent) return;
    const next = deviceState(packet.state);
    if (!next) return;
    lastEvent = packet.event_id;
    if (current && JSON.stringify(current) === JSON.stringify(next)) return;
    current = next;
    for (const listener of [...listeners]) {
      if (!listeners.has(listener)) continue;
      try { listener(next); } catch (error) { report(error); }
    }
  }
  const api = {
    get supported() { return Boolean(bridge) && sameDocument(); },
    stop,
    connect(next, context) {
      if (stopped) return;
      const nextIdentity = JSON.stringify([context.appId, context.user.sub, context.environment]);
      if (bridge) {
        if (!sameDocument() || next !== bridge || nextIdentity !== identity) stop();
        return;
      }
      if (!Array.isArray(next?.capabilities) || !next.capabilities.includes(DEVICE_CAPABILITY) ||
          !validDocumentId(next.documentId) || typeof next.subscribeDevice !== 'function') return;
      bridge = next; documentId = next.documentId; origin = scope.location?.origin; identity = nextIdentity;
      try {
        detach = bridge.subscribeDevice(receive);
        if (typeof detach !== 'function') throw Error();
        if (stopped) detach();
      } catch { stop(); }
    },
    // null before init(), on hosts without device_v1 and before the first state.
    getDevice: () => (api.supported ? current : null),
    onDeviceChange(listener) {
      if (typeof listener !== 'function') throw failure('INVALID_DEVICE_LISTENER');
      if (stopped) throw failure('ACCESS_REVOKED');
      if (!bridge) throw failure('DEVICE_NOT_SUPPORTED');
      if (!sameDocument()) { stop(); throw failure('ACCESS_REVOKED'); }
      const entry = value => listener(value);
      listeners.add(entry);
      return () => { listeners.delete(entry); };
    },
  };
  documents.set(scope, api);
  scope.addEventListener?.('linkminiapp:closed', stop, { once: true });
  scope.addEventListener?.('pagehide', stop, { once: true });
  scope.addEventListener?.('pageshow', event => { if (event.persisted) stop(); });
  return api;
}
