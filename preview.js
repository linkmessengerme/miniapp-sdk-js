// Development aid: draws a stand-in for the Link header over a page opened in an
// ordinary browser and defines the same CSS variables a Link host defines. It
// does nothing inside Link, where the real header is drawn by the client.
import { INSETS_EVENT, INSET_PROPERTIES } from './insets.js';

const DEVICES = Object.freeze({
  phone: { headerHeight: 98, safeArea: { top: 54, right: 0, bottom: 34, left: 0 } },
  desktop: { headerHeight: 52, safeArea: { top: 0, right: 0, bottom: 0, left: 0 } },
});

const STYLE = `
:host { all: initial; }
.bar { position: fixed; inset: 0 0 auto 0; z-index: 2147483647; pointer-events: none;
  font: 600 16px/1.2 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color: var(--ink); --ink: #111; --backing: rgba(255,255,255,.72); }
.row { position: absolute; inset: auto 0 0 0; height: 44px; display: flex; align-items: center;
  justify-content: space-between; padding: 0 8px; box-sizing: border-box; }
.status { position: absolute; inset: 0 0 auto 0; display: flex; align-items: center;
  justify-content: space-between; padding: 0 28px; box-sizing: border-box; font-size: 15px; }
.control, .group, .title { pointer-events: auto; background: var(--backing);
  -webkit-backdrop-filter: blur(16px); backdrop-filter: blur(16px); border-radius: 999px; }
.control { height: 32px; min-width: 32px; display: flex; align-items: center; justify-content: center;
  gap: 14px; padding: 0 10px; box-sizing: border-box; border: 0; color: inherit; font: inherit; cursor: pointer; }
.group { display: flex; align-items: center; height: 32px; padding: 0 2px; }
.group .control { background: none; -webkit-backdrop-filter: none; backdrop-filter: none; }
.title { position: absolute; left: 50%; transform: translateX(-50%); max-width: 50%; padding: 6px 12px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; pointer-events: none; }
.home { position: fixed; left: 50%; transform: translateX(-50%); width: 134px; height: 5px;
  border-radius: 3px; background: var(--ink); opacity: .55; z-index: 2147483647; pointer-events: none; }
@media (prefers-color-scheme: dark) { .bar, .home { --ink: #f2f2f2; --backing: rgba(40,40,40,.62); } }
`;

function values(options) {
  const device = DEVICES[options.device ?? 'phone'];
  if (!device) throw new TypeError('device must be "phone" or "desktop"');
  const safeArea = { ...device.safeArea, ...options.safeArea };
  const headerHeight = options.headerHeight ?? device.headerHeight;
  for (const value of [headerHeight, ...Object.values(safeArea)]) {
    if (!Number.isFinite(value) || value < 0) throw new TypeError('insets must be non-negative numbers');
  }
  return { headerHeight: Math.ceil(headerHeight), safeArea, title: String(options.title ?? 'Mini App') };
}

// The same rule a host installs at document start, kept in an adopted stylesheet.
function rule(v) {
  const px = n => `${Math.ceil(n)}px`;
  return `:root{${INSET_PROPERTIES.headerHeight}:${px(v.headerHeight)};` +
    `${INSET_PROPERTIES.top}:${px(v.safeArea.top)};${INSET_PROPERTIES.right}:${px(v.safeArea.right)};` +
    `${INSET_PROPERTIES.bottom}:${px(v.safeArea.bottom)};${INSET_PROPERTIES.left}:${px(v.safeArea.left)}}`;
}

export function installHeaderPreview(scope = globalThis, options = {}) {
  if (scope.__LinkMiniAppHost || !scope.document?.documentElement) return null;
  const doc = scope.document;
  let current = values(options);
  let sheet, styleElement;
  if (typeof scope.CSSStyleSheet === 'function' && Array.isArray(doc.adoptedStyleSheets)) {
    sheet = new scope.CSSStyleSheet();
    doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
  } else {
    styleElement = doc.createElement('style');
    doc.documentElement.append(styleElement);
  }

  // Outside <body>, so frameworks that own <body> leave it alone.
  const host = doc.createElement('link-miniapp-header-preview');
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>${STYLE}</style>
    <div class="bar" part="bar"><div class="status"><span>9:41</span><span>●●● ▮</span></div>
      <div class="row"><button class="control" type="button" aria-label="Back" data-action="back">‹</button>
        <span class="title"></span>
        <span class="group"><button class="control" type="button" aria-label="More" data-action="more">•••</button>
          <button class="control" type="button" aria-label="Close" data-action="close">✕</button></span></div></div>
    <div class="home"></div>`;
  const bar = shadow.querySelector('.bar');
  const row = shadow.querySelector('.row');
  shadow.addEventListener('click', event => {
    const action = event.target.closest?.('[data-action]')?.dataset.action;
    if (action === 'back') scope.history?.back();
    if (action) scope.console?.info?.(`[Link header preview] ${action}`);
  });
  doc.documentElement.append(host);

  function apply() {
    const css = rule(current);
    if (sheet) sheet.replaceSync(css); else styleElement.textContent = css;
    const { headerHeight, safeArea, title } = current;
    bar.style.height = `${headerHeight}px`;
    bar.querySelector('.status').style.height = `${safeArea.top}px`;
    bar.querySelector('.status').style.display = safeArea.top ? 'flex' : 'none';
    row.style.padding = `0 ${8 + safeArea.right}px 0 ${8 + safeArea.left}px`;
    shadow.querySelector('.title').textContent = title;
    const home = shadow.querySelector('.home');
    home.style.display = safeArea.bottom ? 'block' : 'none';
    home.style.bottom = `${Math.max(0, safeArea.bottom - 13)}px`;
  }
  apply();
  scope.dispatchEvent?.(new Event(INSETS_EVENT));

  return Object.freeze({
    update(next = {}) {
      if (!host.isConnected) return;
      const previous = rule(current);
      current = values({ device: options.device, ...options, ...next });
      options = { ...options, ...next };
      apply();
      if (rule(current) !== previous) scope.dispatchEvent?.(new Event(INSETS_EVENT));
    },
    remove() {
      if (!host.isConnected) return;
      host.remove();
      if (sheet) doc.adoptedStyleSheets = doc.adoptedStyleSheets.filter(s => s !== sheet);
      else styleElement.remove();
      scope.dispatchEvent?.(new Event(INSETS_EVENT));
    },
  });
}
