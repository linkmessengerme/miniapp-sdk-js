// header_v1: the page asks the Link client to change its header (see
// docs/host-bridge.md). One state per document, shared by the default and
// createSDK instances, because there is one header per document. The SDK always
// sends the whole desired state with an increasing revision, so the host applies
// the latest one and a lost or repeated packet cannot leave a half-applied header.
import { validDocumentId } from './back.js';

export const HEADER_CAPABILITY = 'header_v1';
export const MAX_MENU_ITEMS = 5;
export const MAX_MENU_TITLE = 32;
// A user-perceived character can carry any number of combining marks; this keeps
// the whole state far below the 8 KiB packet limit of the contract.
export const MAX_MENU_TITLE_UNITS = 128;
export const BACK_BUTTON_MODES = Object.freeze(['auto', 'back', 'close', 'hidden']);
export const HEADER_ICON_STYLES = Object.freeze(['auto', 'light', 'dark']);
export const HEADER_TITLE_MODES = Object.freeze(['shown', 'hidden']);
export const ORIENTATIONS = Object.freeze(['auto', 'portrait', 'landscape']);
// Names of icons drawn by Link. Pages cannot pass images or URLs.
export const MENU_ICONS = Object.freeze(['settings', 'info', 'help', 'star', 'bookmark', 'edit',
  'search', 'bell', 'user', 'gift', 'cart', 'list', 'chat', 'sound', 'mute', 'pause', 'play', 'restart']);
export const HEADER_EVENTS = Object.freeze(['menu_item', 'minimize', 'restore']);

const MENU_ID = /^[a-z0-9_-]{1,32}$/;
// Control characters, line and paragraph separators and bidirectional overrides.
const UNSAFE_TEXT = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/;
const documents = new WeakMap();
let segmenter;
const graphemes = text => {
  if (segmenter === undefined) segmenter = typeof Intl?.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
  return segmenter ? [...segmenter.segment(text)].length : [...text].length;
};

export const defaultHeaderState = () => ({
  back_button: 'auto', close_confirmation: false, menu_items: [], icons: 'auto', title: 'shown', fullscreen: false,
  orientation: 'auto',
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
    const length = graphemes(text);
    if (length < 1 || length > MAX_MENU_TITLE || text.length > MAX_MENU_TITLE_UNITS) invalid();
    if (icon !== undefined && !MENU_ICONS.includes(icon)) invalid();
    return Object.freeze(icon === undefined ? { id, title: text } : { id, title: text, icon });
  }));
}

export function documentHeader(scope, failure) {
  if (documents.has(scope)) return documents.get(scope);
  let bridge, documentId, origin, identity, detach;
  let stopped = false, scheduled = false, revision = 0, lastEvent = 0, lastSent = JSON.stringify(defaultHeaderState());
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
    if (typeof scope.reportError === 'function') { try { scope.reportError(error); return; } catch { /* fall through */ } }
    setTimeout(() => { throw error; });
  }
  function flush() {
    scheduled = false;
    if (!sameDocument()) { stop(); return; }
    // Nothing is sent when the state equals what the host already has, so a page
    // may call a setter from a scroll handler without crossing the native bridge.
    const text = JSON.stringify(state);
    if (text === lastSent) return;
    lastSent = text;
    const packet = Object.freeze({ version: 1, type: 'link-miniapp:header-state',
      document_id: documentId, revision: ++revision, state: Object.freeze({ ...state }) });
    try { Promise.resolve(bridge.setHeaderState(packet)).catch(stop); }
    catch { stop(); }
  }
  // Calls made together, before the next microtask checkpoint, produce one packet,
  // so the header does not flicker.
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
    const set = listeners[packet.event];
    for (const listener of [...set]) {
      if (!set.has(listener)) continue; // Removed by an earlier listener.
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
      // Only the keys given change; the others keep their current value.
      const keys = style !== null && typeof style === 'object' && !Array.isArray(style) ? Object.keys(style) : [];
      option(keys.length > 0 && keys.every(key => key === 'icons' || key === 'title') &&
        (!('icons' in style) || HEADER_ICON_STYLES.includes(style.icons)) &&
        (!('title' in style) || HEADER_TITLE_MODES.includes(style.title)));
      ready();
      change({ ...(style.icons !== undefined && { icons: style.icons }), ...(style.title !== undefined && { title: style.title }) });
    },
    setFullscreen(enabled) {
      option(typeof enabled === 'boolean'); ready(); change({ fullscreen: enabled });
    },
    setOrientation(orientation) {
      option(ORIENTATIONS.includes(orientation)); ready(); change({ orientation });
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
