import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSDK, MiniAppError } from '../index.js';
import { installHeaderPreview } from '../preview.js';

// A window-like scope whose :root custom properties are a plain map.
function page(properties = {}) {
  const scope = new EventTarget();
  const root = {};
  scope.document = { documentElement: root };
  scope.properties = { ...properties };
  scope.getComputedStyle = element => {
    assert.equal(element, root);
    return { getPropertyValue: name => scope.properties[name] ?? '' };
  };
  return scope;
}
const zero = { headerHeight: 0, safeArea: { top: 0, right: 0, bottom: 0, left: 0 }, controls: { top: 0, right: 0, width: 0, height: 0 } };

test('getInsets reads the host variables without init, rounding up', () => {
  const scope = page({
    '--link-miniapp-header-height': ' 98px', '--link-miniapp-safe-area-top': '54px',
    '--link-miniapp-safe-area-right': '0', '--link-miniapp-safe-area-bottom': '33.5px',
    '--link-miniapp-safe-area-left': '0px',
  });
  const insets = createSDK(scope).getInsets();
  assert.deepEqual(insets, { headerHeight: 98, safeArea: { top: 54, right: 0, bottom: 34, left: 0 }, controls: { top: 0, right: 0, width: 0, height: 0 } });
  assert.ok(Object.isFrozen(insets) && Object.isFrozen(insets.safeArea));
});

test('missing, malformed and foreign values read as 0', () => {
  assert.deepEqual(createSDK(page()).getInsets(), zero);
  for (const bad of ['-10px', '10', '10em', 'calc(10px)', 'auto', '1e3px', 'NaNpx']) {
    assert.equal(createSDK(page({ '--link-miniapp-header-height': bad })).getInsets().headerHeight, 0, bad);
  }
  assert.deepEqual(createSDK({}).getInsets(), zero);
  const throwing = page(); throwing.getComputedStyle = () => { throw new Error('detached'); };
  assert.deepEqual(createSDK(throwing).getInsets(), zero);
});

test('onInsetsChange reports changes once and unsubscribes idempotently', () => {
  const scope = page({ '--link-miniapp-header-height': '98px' });
  const sdk = createSDK(scope);
  const seen = [];
  const off = sdk.onInsetsChange(insets => seen.push(insets.headerHeight));
  scope.dispatchEvent(new Event('linkminiapp:insets'));
  assert.deepEqual(seen, []);
  scope.properties['--link-miniapp-header-height'] = '52px';
  scope.dispatchEvent(new Event('linkminiapp:insets'));
  scope.dispatchEvent(new Event('resize'));
  assert.deepEqual(seen, [52]);
  scope.properties['--link-miniapp-header-height'] = '60px';
  scope.dispatchEvent(new Event('resize'));
  assert.deepEqual(seen, [52, 60]);
  off(); off();
  scope.properties['--link-miniapp-header-height'] = '70px';
  scope.dispatchEvent(new Event('linkminiapp:insets'));
  assert.deepEqual(seen, [52, 60]);
});

test('onInsetsChange requires a function and works after close', async () => {
  const sdk = createSDK(page());
  assert.throws(() => sdk.onInsetsChange(null), error => error instanceof MiniAppError && error.code === 'INVALID_INSETS_LISTENER');
  assert.equal(typeof createSDK({}).onInsetsChange(() => {}), 'function');
});

test('the header preview never draws inside Link', () => {
  const scope = page(); scope.__LinkMiniAppHost = { request() {} };
  assert.equal(installHeaderPreview(scope), null);
  assert.equal(installHeaderPreview({}), null);
  assert.throws(() => installHeaderPreview(page(), { device: 'tablet' }), TypeError);
});

test('header_v1 hosts report the rectangle of the corner capsule', () => {
  const sdk = createSDK(page({ '--link-miniapp-header-height': '52px', '--link-miniapp-safe-area-right': '47px',
    '--link-miniapp-controls-top': '8px', '--link-miniapp-controls-right': '55px',
    '--link-miniapp-controls-width': '76px', '--link-miniapp-controls-height': '32.4px' }));
  assert.deepEqual(sdk.getInsets().controls, { top: 8, right: 55, width: 76, height: 33 });
});

const vars = (prefix, [left, top, width, height]) => ({ [`--link-miniapp-${prefix}-left`]: `${left}px`,
  [`--link-miniapp-${prefix}-top`]: `${top}px`, [`--link-miniapp-${prefix}-width`]: `${width}px`, [`--link-miniapp-${prefix}-height`]: `${height}px` });
const capsule = ([top, right, width, height]) => ({ '--link-miniapp-controls-top': `${top}px`, '--link-miniapp-controls-right': `${right}px`,
  '--link-miniapp-controls-width': `${width}px`, '--link-miniapp-controls-height': `${height}px` });
const sized = (properties, innerWidth) => Object.assign(page(properties), { innerWidth });

test('getHeaderLayout is all null outside Link and on hosts without header_v1', () => {
  const layout = createSDK(page({ '--link-miniapp-header-height': '98px' })).getHeaderLayout();
  assert.deepEqual(layout, { height: 98, back: null, title: null, controls: null, free: null });
  assert.ok(Object.isFrozen(layout));
  assert.deepEqual(createSDK({}).getHeaderLayout(), { height: 0, back: null, title: null, controls: null, free: null });
});

test('portrait app: the title reaches the capsule, so there is no free space', () => {
  const layout = createSDK(sized({ '--link-miniapp-header-height': '112px', '--link-miniapp-safe-area-top': '54px',
    ...vars('back', [12, 61, 44, 44]), ...vars('title', [64, 61, 217, 44]), ...capsule([61, 12, 89, 44]) }, 390)).getHeaderLayout();
  assert.deepEqual(layout.back, { x: 12, y: 61, width: 44, height: 44 });
  assert.deepEqual(layout.title, { x: 64, y: 61, width: 217, height: 44 });
  assert.deepEqual(layout.controls, { x: 289, y: 61, width: 89, height: 44 });
  assert.equal(layout.free, null);
});

test('landscape app: the compact title leaves a gap the page can use', () => {
  const layout = createSDK(sized({ '--link-miniapp-header-height': '52px', '--link-miniapp-safe-area-left': '59px',
    '--link-miniapp-safe-area-right': '59px', ...vars('back', [65, 6, 36, 36]), ...vars('title', [109, 6, 120, 36]),
    ...capsule([6, 65, 81, 38]) }, 844)).getHeaderLayout();
  assert.deepEqual(layout.controls, { x: 698, y: 6, width: 81, height: 38 });
  assert.deepEqual(layout.free, { x: 237, y: 6, width: 453, height: 38 });
});

test('fullscreen game: free row in landscape, none in the camera band in portrait', () => {
  const landscape = createSDK(sized({ '--link-miniapp-header-height': '48px', '--link-miniapp-safe-area-left': '59px',
    '--link-miniapp-safe-area-right': '59px', ...capsule([8, 67, 84, 32]) }, 844)).getHeaderLayout();
  assert.equal(landscape.back, null); assert.equal(landscape.title, null);
  assert.deepEqual(landscape.free, { x: 67, y: 8, width: 618, height: 32 });
  const portrait = createSDK(sized({ '--link-miniapp-header-height': '54px', '--link-miniapp-safe-area-top': '54px',
    ...capsule([12, 14, 84, 32]) }, 390)).getHeaderLayout();
  assert.deepEqual(portrait.controls, { x: 292, y: 12, width: 84, height: 32 });
  assert.equal(portrait.free, null);
});

test('onHeaderLayoutChange reports a changed layout once and stops after unsubscribe', () => {
  const scope = sized({ ...vars('back', [12, 61, 44, 44]), ...capsule([61, 12, 89, 44]) }, 390);
  const sdk = createSDK(scope), seen = [];
  const off = sdk.onHeaderLayoutChange(layout => seen.push(layout.back));
  scope.dispatchEvent(new Event('linkminiapp:insets'));
  assert.equal(seen.length, 0);
  for (const name of ['left', 'top', 'width', 'height']) delete scope.properties[`--link-miniapp-back-${name}`];
  scope.dispatchEvent(new Event('linkminiapp:insets'));
  assert.deepEqual(seen, [null]);
  scope.innerWidth = 844; scope.dispatchEvent(new Event('resize'));
  assert.equal(seen.length, 2);
  off(); off();
  scope.innerWidth = 390; scope.dispatchEvent(new Event('resize'));
  assert.equal(seen.length, 2);
  assert.throws(() => sdk.onHeaderLayoutChange(null), { code: 'INVALID_LAYOUT_LISTENER' });
});

test('portrait app with the title hidden: the header row becomes free', () => {
  const layout = createSDK(sized({ '--link-miniapp-header-height': '112px', '--link-miniapp-safe-area-top': '54px',
    ...vars('back', [12, 61, 44, 44]), ...capsule([61, 12, 89, 44]) }, 390)).getHeaderLayout();
  assert.equal(layout.title, null);
  assert.deepEqual(layout.free, { x: 64, y: 61, width: 217, height: 44 });
});
