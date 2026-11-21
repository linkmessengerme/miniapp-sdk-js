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
});

function pixels(style, name) {
  const match = /^(\d+(?:\.\d+)?)(px)?$/.exec(String(style?.getPropertyValue?.(name) ?? '').trim());
  if (!match || (match[2] === undefined && Number(match[1]) !== 0)) return 0;
  return Math.ceil(Number(match[1]));
}

export function readInsets(scope) {
  let style;
  try {
    const root = scope.document?.documentElement;
    if (root && typeof scope.getComputedStyle === 'function') style = scope.getComputedStyle(root);
  } catch { style = undefined; }
  const value = name => pixels(style, INSET_PROPERTIES[name]);
  return Object.freeze({
    headerHeight: value('headerHeight'),
    safeArea: Object.freeze({ top: value('top'), right: value('right'), bottom: value('bottom'), left: value('left') }),
  });
}

const key = insets => [insets.headerHeight, insets.safeArea.top, insets.safeArea.right,
  insets.safeArea.bottom, insets.safeArea.left].join(' ');

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
