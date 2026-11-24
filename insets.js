// The Link host draws a transparent header over the page and defines these CSS
// custom properties on :root (see docs/host-bridge.md). Hosts without the overlay
// header, the browser host and ordinary browsers define none of them: every value
// is then 0, and the same layout code works unchanged.
export const INSETS_EVENT = 'linkminiapp:insets';
export const INSET_PROPERTIES = Object.freeze({
  headerHeight: '--link-miniapp-header-height',
  top: '--link-miniapp-safe-area-top',
  right: '--link-miniapp-safe-area-right',
  bottom: '--link-miniapp-safe-area-bottom',
  left: '--link-miniapp-safe-area-left',
  // header_v1: the rectangle of the ⋯ capsule, from the top and right edges.
  controlsTop: '--link-miniapp-controls-top',
  controlsRight: '--link-miniapp-controls-right',
  controlsWidth: '--link-miniapp-controls-width',
  controlsHeight: '--link-miniapp-controls-height',
  // header_v1: the left button (✕ / ‹) and the title capsule, from the top and left edges.
  // Undefined while the element is not shown.
  backLeft: '--link-miniapp-back-left',
  backTop: '--link-miniapp-back-top',
  backWidth: '--link-miniapp-back-width',
  backHeight: '--link-miniapp-back-height',
  titleLeft: '--link-miniapp-title-left',
  titleTop: '--link-miniapp-title-top',
  titleWidth: '--link-miniapp-title-width',
  titleHeight: '--link-miniapp-title-height',
});
// The page may use the gap in the header row only when it is at least this wide.
export const MIN_FREE_WIDTH = 48;
const GAP = 8;

// Sizes round up and positions round down, so a rectangle always covers its control.
function pixels(style, name, round = Math.ceil) {
  const match = /^(\d+(?:\.\d+)?)(px)?$/.exec(String(style?.getPropertyValue?.(name) ?? '').trim());
  if (!match || (match[2] === undefined && Number(match[1]) !== 0)) return 0;
  return round(Number(match[1]));
}
const POSITIONS = new Set(['controlsTop', 'controlsRight', 'backLeft', 'backTop', 'titleLeft', 'titleTop']);
const reader = style => name => pixels(style, INSET_PROPERTIES[name], POSITIONS.has(name) ? Math.floor : Math.ceil);

function rootStyle(scope) {
  try {
    const root = scope.document?.documentElement;
    if (root && typeof scope.getComputedStyle === 'function') return scope.getComputedStyle(root);
  } catch { /* No layout information. */ }
  return undefined;
}

function insetsFrom(style) {
  const value = reader(style);
  return Object.freeze({
    headerHeight: value('headerHeight'),
    safeArea: Object.freeze({ top: value('top'), right: value('right'), bottom: value('bottom'), left: value('left') }),
    controls: Object.freeze({ top: value('controlsTop'), right: value('controlsRight'),
      width: value('controlsWidth'), height: value('controlsHeight') }),
  });
}

const rect = (x, y, width, height) => (width > 0 && height > 0 ? Object.freeze({ x, y, width, height }) : null);

function viewportWidth(scope) {
  const width = Number(scope.innerWidth ?? scope.document?.documentElement?.clientWidth);
  return Number.isFinite(width) && width > 0 ? Math.floor(width) : 0;
}

// Rectangles of the Link header controls in CSS pixels from the top left corner
// of the page, for laying out the page's own controls next to them. The host
// reports touch areas, which may be larger than the drawn controls.
function layoutFrom(scope, style, insets) {
  const value = reader(style);
  const back = rect(value('backLeft'), value('backTop'), value('backWidth'), value('backHeight'));
  const title = rect(value('titleLeft'), value('titleTop'), value('titleWidth'), value('titleHeight'));
  const width = viewportWidth(scope), c = insets.controls;
  const controls = width ? rect(width - c.right - c.width, c.top, c.width, c.height) : null;
  // The gap in the header row between the left controls (or the left safe area)
  // and the capsule, with 8 px margins. A capsule that starts inside the top safe
  // area sits in the camera band (fullscreen portrait); that row is interrupted
  // by the notch or Dynamic Island and is not offered.
  let free = null;
  if (controls && controls.y >= insets.safeArea.top) {
    const start = Math.max(insets.safeArea.left, ...[back, title].filter(Boolean).map(r => r.x + r.width)) + GAP;
    const end = controls.x - GAP;
    if (end - start >= MIN_FREE_WIDTH) free = rect(start, controls.y, end - start, controls.height);
  }
  return Object.freeze({ height: insets.headerHeight, back, title, controls, free });
}

export const readInsets = scope => insetsFrom(rootStyle(scope));
export function readHeaderLayout(scope) {
  const style = rootStyle(scope);
  return layoutFrom(scope, style, insetsFrom(style));
}

const insetsKey = i => [i.headerHeight, i.safeArea.top, i.safeArea.right, i.safeArea.bottom, i.safeArea.left,
  i.controls.top, i.controls.right, i.controls.width, i.controls.height].join(' ');
const rectKey = r => (r ? [r.x, r.y, r.width, r.height].join(',') : '-');
const layoutKey = l => [l.height, rectKey(l.back), rectKey(l.title), rectKey(l.controls), rectKey(l.free)].join(' ');

function report(scope, error) {
  // An application listener must not stop the others; surface its error anyway.
  if (typeof scope.reportError === 'function') { try { scope.reportError(error); return; } catch { /* fall through */ } }
  setTimeout(() => { throw error; });
}

// One watcher per document serves every insets and layout listener. The host
// announces changes with INSETS_EVENT; a resize is checked as well. The values are
// read once per frame, in requestAnimationFrame, after the page's own handlers
// have changed its layout, so the browser recalculates styles once rather than
// once for the SDK and again for the page. Without requestAnimationFrame the read
// happens once at the end of the current task.
const watchers = new WeakMap();
function watcher(scope) {
  if (watchers.has(scope)) return watchers.get(scope);
  const entries = new Set();
  let scheduled = false;
  const run = () => {
    scheduled = false;
    if (!entries.size) return;
    const style = rootStyle(scope), insets = insetsFrom(style);
    let layout;
    for (const entry of [...entries]) {
      if (!entries.has(entry)) continue; // Removed by an earlier listener.
      const value = entry.layout ? (layout ??= layoutFrom(scope, style, insets)) : insets;
      const key = entry.layout ? layoutKey(value) : insetsKey(value);
      if (key === entry.last) continue;
      entry.last = key;
      try { entry.listener(value); } catch (error) { report(scope, error); }
    }
  };
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    if (typeof scope.requestAnimationFrame === 'function') scope.requestAnimationFrame(run);
    else queueMicrotask(run);
  };
  const api = {
    add(entry) {
      if (!entries.size) { scope.addEventListener(INSETS_EVENT, schedule); scope.addEventListener('resize', schedule); }
      entries.add(entry);
    },
    remove(entry) {
      if (!entries.delete(entry) || entries.size) return;
      scope.removeEventListener?.(INSETS_EVENT, schedule);
      scope.removeEventListener?.('resize', schedule);
    },
  };
  watchers.set(scope, api);
  return api;
}

function subscribe(scope, listener, layout, failure, code) {
  if (typeof listener !== 'function') throw failure(code);
  if (typeof scope.addEventListener !== 'function') return () => {};
  const style = rootStyle(scope), insets = insetsFrom(style);
  const entry = { listener, layout, last: layout ? layoutKey(layoutFrom(scope, style, insets)) : insetsKey(insets) };
  const w = watcher(scope);
  w.add(entry);
  return () => w.remove(entry);
}

export const subscribeInsets = (scope, listener, failure) =>
  subscribe(scope, listener, false, failure, 'INVALID_INSETS_LISTENER');
export const subscribeHeaderLayout = (scope, listener, failure) =>
  subscribe(scope, listener, true, failure, 'INVALID_LAYOUT_LISTENER');
