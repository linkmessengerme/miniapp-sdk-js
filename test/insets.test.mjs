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
const zero = { headerHeight: 0, safeArea: { top: 0, right: 0, bottom: 0, left: 0 } };

test('getInsets reads the host variables without init, rounding up', () => {
  const scope = page({
    '--link-miniapp-header-height': ' 98px', '--link-miniapp-safe-area-top': '54px',
    '--link-miniapp-safe-area-right': '0', '--link-miniapp-safe-area-bottom': '33.5px',
    '--link-miniapp-safe-area-left': '0px',
  });
  const insets = createSDK(scope).getInsets();
  assert.deepEqual(insets, { headerHeight: 98, safeArea: { top: 54, right: 0, bottom: 34, left: 0 } });
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
