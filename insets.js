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

function pixels(style, name) {
  const match = /^(\d+(?:\.\d+)?)(px)?$/.exec(String(style?.getPropertyValue?.(name) ?? '').trim());
  if (!match || (match[2] === undefined && Number(match[1]) !== 0)) return 0;
  return Math.ceil(Number(match[1]));
}

function rootStyle(scope) {
  try {
    const root = scope.document?.documentElement;
    if (root && typeof scope.getComputedStyle === 'function') return scope.getComputedStyle(root);
  } catch { /* No layout information. */ }
  return undefined;
}

export function readInsets(scope) {
  const style = rootStyle(scope);
  const value = name => pixels(style, INSET_PROPERTIES[name]);
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
// of the page, for laying out the page's own controls next to them.
export function readHeaderLayout(scope) {
  const style = rootStyle(scope);
  const value = name => pixels(style, INSET_PROPERTIES[name]);
  const insets = readInsets(scope);
  const back = rect(value('backLeft'), value('backTop'), value('backWidth'), value('backHeight'));
  const title = rect(value('titleLeft'), value('titleTop'), value('titleWidth'), value('titleHeight'));
  const width = viewportWidth(scope), c = insets.controls;
  const controls = width ? rect(width - c.right - c.width, c.top, c.width, c.height) : null;
  // The gap in the header row between the left elements (or the left safe area)
  // and the ⋯ capsule, with an 8 px margin on both sides.
  // When the capsule sits in the camera band (fullscreen portrait), that row is
  // interrupted by the notch or Dynamic Island and is not offered as free space.
  let free = null;
  if (controls && controls.y + controls.height > insets.safeArea.top) {
    const start = Math.max(insets.safeArea.left, ...[back, title].filter(Boolean).map(r => r.x + r.width)) + GAP;
    const end = controls.x - GAP;
    if (end - start >= MIN_FREE_WIDTH) free = rect(start, controls.y, end - start, controls.height);
  }
  return Object.freeze({ height: insets.headerHeight, back, title, controls, free });
}

const rectKey = r => (r ? [r.x, r.y, r.width, r.height].join(',') : '-');
const layoutKey = l => [l.height, rectKey(l.back), rectKey(l.title), rectKey(l.controls), rectKey(l.free)].join(' ');

export function subscribeHeaderLayout(scope, listener, failure) {
  if (typeof listener !== 'function') throw failure('INVALID_LAYOUT_LISTENER');
  if (typeof scope.addEventListener !== 'function') return () => {};
  let last = layoutKey(readHeaderLayout(scope)), active = true;
  const check = () => {
    if (!active) return;
    const next = readHeaderLayout(scope);
    const nextKey = layoutKey(next);
    if (nextKey === last) return;
    last = nextKey;
    listener(next);
  };
  scope.addEventListener(INSETS_EVENT, check);
  scope.addEventListener('resize', check);
  return () => {
    if (!active) return;
    active = false;
    scope.removeEventListener?.(INSETS_EVENT, check);
    scope.removeEventListener?.('resize', check);
  };
}

const key = insets => [insets.headerHeight, insets.safeArea.top, insets.safeArea.right,
  insets.safeArea.bottom, insets.safeArea.left, insets.controls.top, insets.controls.right,
  insets.controls.width, insets.controls.height].join(' ');

// The host announces changes with INSETS_EVENT. A resize is checked as well, so a
// listener also hears about a change the host made together with a window resize.
export function subscribeInsets(scope, listener, failure) {
  if (typeof listener !== 'function') throw failure('INVALID_INSETS_LISTENER');
  if (typeof scope.addEventListener !== 'function') return () => {};
  let last = key(readInsets(scope)), active = true;
  const check = () => {
    if (!active) return;
    const next = readInsets(scope);
    const nextKey = key(next);
    if (nextKey === last) return;
    last = nextKey;
    listener(next);
  };
  scope.addEventListener(INSETS_EVENT, check);
  scope.addEventListener('resize', check);
  return () => {
    if (!active) return;
    active = false;
    scope.removeEventListener?.(INSETS_EVENT, check);
    scope.removeEventListener?.('resize', check);
  };
}
