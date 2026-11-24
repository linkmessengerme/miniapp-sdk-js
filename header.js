// header_v1: the page asks the Link client to change its header (see
// docs/host-bridge.md). One state per document, shared by the default and
// createSDK instances, because there is one header per document. The SDK always
// sends the whole desired state with an increasing revision, so the host applies
// the latest one and a lost or repeated packet cannot leave a half-applied header.
import { validDocumentId } from './back.js';

export const HEADER_CAPABILITY = 'header_v1';
export const MAX_MENU_ITEMS = 5;
export const MAX_MENU_TITLE = 32;
export const BACK_BUTTON_MODES = Object.freeze(['auto', 'back', 'close', 'hidden']);
export const HEADER_ICON_STYLES = Object.freeze(['auto', 'light', 'dark']);
// Names of icons drawn by Link. Pages cannot pass images or URLs.
export const MENU_ICONS = Object.freeze(['settings', 'info', 'help', 'star', 'bookmark', 'edit',
  'search', 'bell', 'user', 'gift', 'cart', 'list', 'chat', 'sound', 'mute', 'pause', 'play', 'restart']);
export const HEADER_EVENTS = Object.freeze(['menu_item', 'minimize', 'restore']);

const MENU_ID = /^[a-z0-9_-]{1,32}$/;
// Control characters, line and paragraph separators and bidirectional overrides.
const UNSAFE_TEXT = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/;
const documents = new WeakMap();

export const defaultHeaderState = () => ({
  back_button: 'auto', close_confirmation: false, menu_items: [], icons: 'auto', fullscreen: false,
});

export function isHeaderEvent(packet, documentId) {
  if (packet?.version !== 1 || packet.type !== 'link-miniapp:header-event' ||
      packet.document_id !== documentId || !Number.isSafeInteger(packet.event_id) ||
      packet.event_id <= 0 || !HEADER_EVENTS.includes(packet.event)) return false;
  return packet.event === 'menu_item' ? typeof packet.item_id === 'string' && MENU_ID.test(packet.item_id)
    : packet.item_id === undefined;
}

// Returns a frozen wire copy or throws INVALID_MENU_ITEMS.
export function menuItems(items, failure) {
  const invalid = () => { throw failure('INVALID_MENU_ITEMS'); };
  if (!Array.isArray(items) || items.length > MAX_MENU_ITEMS) invalid();
  const ids = new Set();
  return Object.freeze(items.map(item => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) invalid();
    const { id, title, icon } = item;
    if (typeof id !== 'string' || !MENU_ID.test(id) || ids.has(id)) invalid();
    ids.add(id);
    if (typeof title !== 'string' || UNSAFE_TEXT.test(title)) invalid();
    const text = title.trim();
    // Length in user-perceived characters, so an emoji or a Turkmen letter counts once.
    const length = typeof Intl?.Segmenter === 'function'
      ? [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].length : [...text].length;
    if (length < 1 || length > MAX_MENU_TITLE) invalid();
    if (icon !== undefined && !MENU_ICONS.includes(icon)) invalid();
    return Object.freeze(icon === undefined ? { id, title: text } : { id, title: text, icon });
  }));
}

export function documentHeader(scope, failure) {
  if (documents.has(scope)) return documents.get(scope);
  let bridge, documentId, origin, identity, detach;
  let stopped = false, scheduled = false, revision = 0, lastEvent = 0;
  let state = defaultHeaderState();
  const listeners = { menu_item: new Set(), minimize: new Set(), restore: new Set() };
  const sameDocument = () => !stopped && scope.__LinkMiniAppHost === bridge &&
    bridge.documentId === documentId && scope.location?.origin === origin &&
    (!('top' in scope) || scope.top === scope);

  function stop() {
    if (stopped) return;
    stopped = true;
    for (const set of Object.values(listeners)) set.clear();
    try { detach?.(); } catch { /* The host is already being torn down. */ }
  }
  function report(error) {
    // A failing application listener must not stop other listeners or the bridge.
    try { scope.reportError?.(error); } catch { /* Nothing else to do. */ }
  }
  function flush() {
    scheduled = false;
    if (!sameDocument()) { stop(); return; }
    const packet = Object.freeze({ version: 1, type: 'link-miniapp:header-state',
      document_id: documentId, revision: ++revision, state: Object.freeze({ ...state }) });
    try { Promise.resolve(bridge.setHeaderState(packet)).catch(stop); }
    catch { stop(); }
  }
  // Several calls in one task produce one packet, so the header does not flicker.
  function change(next) {
    state = { ...state, ...next };
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(flush);
  }
  function receive(packet) {
    if (!sameDocument()) { stop(); return; }
    if (!isHeaderEvent(packet, documentId) || packet.event_id <= lastEvent) return;
    lastEvent = packet.event_id;
    // A tap on an item the page has removed since the menu opened is dropped.
    if (packet.event === 'menu_item' && !state.menu_items.some(item => item.id === packet.item_id)) return;
    for (const listener of [...listeners[packet.event]]) {
      try {
        const result = packet.event === 'menu_item' ? listener(packet.item_id) : listener();
        if (typeof result?.then === 'function') Promise.resolve(result).catch(report);
      } catch (error) { report(error); }
    }
  }
  function ready() {
    if (stopped) throw failure('ACCESS_REVOKED');
    if (!bridge) throw failure('HEADER_NOT_SUPPORTED');
    if (!sameDocument()) { stop(); throw failure('ACCESS_REVOKED'); }
  }
  function subscribe(event, listener) {
    if (typeof listener !== 'function') throw failure('INVALID_HEADER_LISTENER');
    ready();
    const entry = value => listener(value);
    listeners[event].add(entry);
    return () => { listeners[event].delete(entry); };
  }
  function option(valid) { if (!valid) throw failure('INVALID_HEADER_OPTION'); }

  const api = {
    get closed() { return stopped; },
    get supported() { return Boolean(bridge) && sameDocument(); },
    stop,
    ready,
    connect(next, context) {
      if (stopped) return;
      const nextIdentity = JSON.stringify([context.appId, context.user.sub, context.environment]);
      if (bridge) {
        if (!sameDocument() || next !== bridge || nextIdentity !== identity) stop();
        return;
      }
      if (!Array.isArray(next?.capabilities) || !next.capabilities.includes(HEADER_CAPABILITY) ||
          !validDocumentId(next.documentId) || typeof next.setHeaderState !== 'function' ||
          typeof next.subscribeHeader !== 'function') return;
      bridge = next; documentId = next.documentId; origin = scope.location?.origin; identity = nextIdentity;
      try {
        detach = bridge.subscribeHeader(receive);
        if (typeof detach !== 'function') throw Error();
        if (stopped) detach();
      } catch { stop(); }
    },
    setBackButton(mode) {
      option(BACK_BUTTON_MODES.includes(mode)); ready(); change({ back_button: mode });
    },
    setCloseConfirmation(enabled) {
      option(typeof enabled === 'boolean'); ready(); change({ close_confirmation: enabled });
    },
    setMenuItems(items) {
      const wire = menuItems(items, failure); ready(); change({ menu_items: wire });
    },
    setHeaderStyle(style) {
      option(style !== null && typeof style === 'object' && !Array.isArray(style) &&
        Object.keys(style).every(key => key === 'icons') && HEADER_ICON_STYLES.includes(style.icons));
      ready(); change({ icons: style.icons });
    },
    setFullscreen(enabled) {
      option(typeof enabled === 'boolean'); ready(); change({ fullscreen: enabled });
    },
    onMenuItem: listener => subscribe('menu_item', listener),
    onMinimize: listener => subscribe('minimize', listener),
    onRestore: listener => subscribe('restore', listener),
  };
  documents.set(scope, api);
  scope.addEventListener?.('linkminiapp:closed', stop, { once: true });
  scope.addEventListener?.('pagehide', stop, { once: true });
  scope.addEventListener?.('pageshow', event => { if (event.persisted) stop(); });
  return api;
}
