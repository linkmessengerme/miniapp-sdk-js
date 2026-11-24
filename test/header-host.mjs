// Synthetic host reference for header_v1 contract tests, not a client implementation.
// It shows what a native host must check itself instead of trusting the page:
// document, revision, every field and limit, and the rules the page cannot change.
export const SYSTEM_MENU = Object.freeze(['Обновить', 'Поделиться', 'Скопировать ссылку', 'О приложении',
  'Пожаловаться', 'Закрыть приложение']);
const MODES = ['auto', 'back', 'close', 'hidden'];
const ICONS = ['auto', 'light', 'dark'];
const MENU_ICONS = ['settings', 'info', 'help', 'star', 'bookmark', 'edit', 'search', 'bell', 'user',
  'gift', 'cart', 'list', 'chat', 'sound', 'mute', 'pause', 'play', 'restart'];
const ORIENTATIONS = ['auto', 'portrait', 'landscape'];
const TITLES = ['shown', 'hidden'];
const DEFAULTS = Object.freeze({ back_button: 'auto', close_confirmation: false, menu_items: [], icons: 'auto', title: 'shown', fullscreen: false, orientation: 'auto', sound_control: false });

function validItems(items) {
  if (!Array.isArray(items) || items.length > 5) return false;
  const ids = new Set();
  return items.every(item => {
    if (!item || typeof item !== 'object' || !/^[a-z0-9_-]{1,32}$/.test(item.id) || ids.has(item.id)) return false;
    ids.add(item.id);
    const title = typeof item.title === 'string' ? item.title.trim() : '';
    if (!title || [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(title)].length > 32 ||
        /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/.test(item.title)) return false;
    return item.icon === undefined || typeof item.icon === 'string';
  });
}

export function headerHost({ documentId, send = () => {}, close = () => {}, minimize = () => {} }) {
  let state = DEFAULTS, revision = 0, sequence = 0, minimized = false, closed = false, confirmations = 0;
  // Link remembers the mute choice per app; pauses are a set of reasons, reported on the first and the last.
  let muted = false;
  const pauses = new Set();
  const event = (name, extra = {}) => {
    const packet = { version: 1, type: 'link-miniapp:header-event', document_id: documentId,
      event_id: ++sequence, event: name, ...extra };
    send(packet);
    return packet;
  };
  const host = {
    get state() { return state; },
    get revision() { return revision; },
    get minimized() { return minimized; },
    get closed() { return closed; },
    get confirmations() { return confirmations; },
    applied: [],
    apply(packet) {
      const next = packet?.state;
      if (closed || packet?.version !== 1 || packet.type !== 'link-miniapp:header-state' ||
          packet.document_id !== documentId || !Number.isSafeInteger(packet.revision) ||
          packet.revision <= revision || !next || typeof next !== 'object' ||
          !MODES.includes(next.back_button) || typeof next.close_confirmation !== 'boolean' ||
          !ICONS.includes(next.icons) || !TITLES.includes(next.title) || typeof next.fullscreen !== 'boolean' || !ORIENTATIONS.includes(next.orientation) || typeof next.sound_control !== 'boolean' ||
          !validItems(next.menu_items)) return false;
      revision = packet.revision;
      const soundTurnedOn = next.sound_control && !state.sound_control;
      // Unknown icons are drawn without an icon; items that look like Link items are dropped.
      const system = new Set(SYSTEM_MENU.map(title => title.toLocaleLowerCase()));
      state = { ...next, menu_items: next.menu_items
        .filter(item => !system.has(item.title.trim().toLocaleLowerCase()))
        .map(item => ({ id: item.id, title: item.title.trim(), ...(MENU_ICONS.includes(item.icon) ? { icon: item.icon } : {}) })) };
      host.applied.push(packet);
      if (soundTurnedOn) event('sound', { muted }); // The page learns the remembered choice.
      return true;
    },
    // What the user sees. Close and minimize are always reachable.
    view() {
      const own = state.menu_items.map(item => item.title);
      const sound = state.sound_control ? [muted ? 'Включить звук' : 'Без звука'] : [];
      const menu = [...own, ...SYSTEM_MENU.slice(0, -1), ...sound, ...(state.fullscreen ? ['Свернуть'] : []), SYSTEM_MENU.at(-1)];
      // Without the title capsule the name and icon head the ⋯ menu, so the app is always identified.
      const identity = state.fullscreen || state.title === 'hidden' ? ['«App» · мини-приложение'] : [];
      if (state.fullscreen) return { left: null, title: false, capsule: ['⋯', '✕'], menu: [...identity, ...menu] };
      const left = state.back_button === 'hidden' ? null : state.back_button === 'auto' ? 'auto' : state.back_button;
      return { left, title: state.title === 'shown', capsule: ['⋯', '⌄'], menu: [...identity, ...menu] };
    },
    openMenu() { host.pause('overlay'); },
    closeMenu() { host.resume('overlay'); },
    tapMenu(title) {
      const item = state.menu_items.find(entry => entry.title === title);
      if (item) return event('menu_item', { item_id: item.id });
      if (title === 'Закрыть приложение') return host.userClose();
      if (title === 'Свернуть') return host.minimize();
      if (state.sound_control && (title === 'Без звука' || title === 'Включить звук')) { muted = !muted; return event('sound', { muted }); }
      return undefined;
    },
    // A close the user started: ✕, the menu, a gesture or Back that ended in close.
    userClose(confirm = () => true) {
      if (closed) return false;
      if (state.close_confirmation) { confirmations++; if (!confirm()) return false; }
      return host.end('user');
      return true;
    },
    // closing goes out first; the host keeps the page alive about 300 ms before teardown.
    end(reason) {
      if (closed) return false;
      event('closing', { reason });
      closed = true; close();
      return true;
    },
    pause(reason) { const first = pauses.size === 0; pauses.add(reason); if (first) event('pause', { reason }); },
    resume(reason) { if (!pauses.delete(reason) || pauses.size) return; event('resume'); },
    // minimize goes out when minimizing starts, then pause.
    minimize() {
      if (closed || minimized) return false;
      minimized = true; event('minimize'); host.pause('minimized'); minimize();
      return true;
    },
    restore() {
      if (closed || !minimized) return false;
      minimized = false; event('restore'); host.resume('minimized');
      return true;
    },
    get muted() { return muted; },
    request(method) {
      if (method !== 'minimize') return { error: { code: 'NOT_SUPPORTED' } };
      return host.minimize() ? { result: {} } : { error: { code: 'MINIMIZE_NOT_AVAILABLE' } };
    },
    // A new document always starts from the defaults.
    navigate(nextDocumentId) { documentId = nextDocumentId; state = DEFAULTS; revision = 0; sequence = 0; },
    event,
  };
  return host;
}
