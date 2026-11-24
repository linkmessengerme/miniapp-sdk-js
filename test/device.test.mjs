import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createSDK } from '../index.js';

const state = (changes = {}) => ({ platform: 'android', link_version: '7.1.0', performance: 'mid', thermal: 'nominal',
  power_saving: false, battery_low: false, ...changes });

async function fixture(t, { capabilities = ['back_v1', 'header_v1', 'device_v1'], init = true, initial = state() } = {}) {
  const scope = Object.assign(new EventTarget(), { crypto: webcrypto, location: new URL('https://mini.example') });
  scope.top = scope;
  const documentId = webcrypto.randomUUID();
  let listener, sequence = 0;
  const launch = { result: 'LAUNCH_RESULT_READY', launch_id: 'launch', ready: {
    app_id: 'app', sub: 'user', environment: 'ENVIRONMENT_TEST', expires_at: new Date(Date.now() + 60000).toISOString(),
    web: { id_token: 'synthetic-proof', allowed_origins: [scope.location.origin] } } };
  const send = (next, extra = {}) => listener?.({ version: 1, type: 'link-miniapp:device', document_id: documentId, event_id: ++sequence, state: next, ...extra });
  const bridge = { documentId, capabilities,
    subscribeBack: () => () => {}, ackBack() {}, subscribeHeader: () => () => {}, setHeaderState() {},
    subscribeDevice(fn) { listener = fn; if (initial) send(initial); return () => { listener = undefined; }; },
    request: packet => ({ version: 1, request_id: packet.request_id, result: packet.method === 'init' ? launch : {} }) };
  scope.__LinkMiniAppHost = bridge;
  const sdk = createSDK(scope);
  if (init) await sdk.init();
  t.after(() => scope.dispatchEvent(new Event('pagehide')));
  return { sdk, scope, bridge, launch, documentId, send, get listening() { return listener !== undefined; } };
}

test('getDevice returns the coarse state the host sent on subscription, in camelCase', async t => {
  const f = await fixture(t);
  const device = f.sdk.getDevice();
  assert.deepEqual(device, { platform: 'android', linkVersion: '7.1.0', performance: 'mid', thermal: 'nominal', powerSaving: false, batteryLow: false });
  assert.ok(Object.isFrozen(device));
});

test('onDeviceChange reports real changes only; foreign, stale and malformed packets are ignored', async t => {
  const f = await fixture(t), seen = [];
  f.sdk.onDeviceChange(next => seen.push([next.thermal, next.powerSaving]));
  f.send(state());                                   // same state: nothing
  f.send(state({ thermal: 'serious' }));
  f.send(state({ power_saving: true, thermal: 'serious' }));
  for (const bad of [{ platform: 'windows' }, { performance: 'ultra' }, { thermal: 'hot' }, { power_saving: 'yes' },
    { battery_low: 1 }, { link_version: 'x'.repeat(33) }, { link_version: '7.1 beta' }]) f.send(state({ thermal: 'critical', ...bad }));
  f.send(state({ thermal: 'critical' }), { document_id: webcrypto.randomUUID() });
  f.send(state({ thermal: 'critical' }), { event_id: 1 });
  assert.deepEqual(seen, [['serious', false], ['serious', true]]);
  assert.equal(f.sdk.getDevice().powerSaving, true);
});

test('without device_v1 or before init: null state, DEVICE_NOT_SUPPORTED for listeners, supports() false', async t => {
  const old = await fixture(t, { capabilities: ['back_v1', 'header_v1'] });
  assert.equal(old.sdk.getDevice(), null);
  assert.throws(() => old.sdk.onDeviceChange(() => {}), { name: 'MiniAppError', code: 'DEVICE_NOT_SUPPORTED' });
  assert.equal(old.sdk.supports('device_v1'), false);
  assert.equal(old.sdk.supports('header_v1'), true);
  const early = await fixture(t, { init: false });
  assert.equal(early.sdk.getDevice(), null);
  assert.equal(early.sdk.supports('header_v1'), false);
  assert.throws(() => early.sdk.onDeviceChange(() => {}), { code: 'DEVICE_NOT_SUPPORTED' });
  assert.throws(() => old.sdk.onDeviceChange('x'), { code: 'INVALID_DEVICE_LISTENER' });
});

test('supports() reflects complete extensions only', async t => {
  const f = await fixture(t, { init: false, capabilities: ['back_v1', 'header_v1', 'device_v1', 'payments_v1'] });
  delete f.bridge.subscribeDevice;
  await f.sdk.init();
  assert.equal(f.sdk.supports('device_v1'), false);   // advertised but incomplete
  assert.equal(f.sdk.supports('back_v1'), true);
  assert.equal(f.sdk.supports('payments_v1'), true);
  assert.equal(f.sdk.supports('teleport_v1'), false);
  assert.equal(f.sdk.supports(42), false);
  await f.sdk.close();
  assert.equal(f.sdk.supports('back_v1'), false);
});

test('teardown and identity change stop device updates', async t => {
  for (const end of [f => f.scope.dispatchEvent(new Event('pagehide')), async f => { f.launch.ready.sub = 'other'; await f.sdk.init().catch(() => {}); }]) {
    const f = await fixture(t);
    await end(f);
    assert.equal(f.sdk.getDevice(), null);
    assert.equal(f.listening, false);
  }
});

test('a throwing device listener does not stop the others', async t => {
  const f = await fixture(t), seen = [], errors = [];
  f.scope.reportError = error => errors.push(error.message);
  f.sdk.onDeviceChange(() => { throw new Error('bug'); });
  f.sdk.onDeviceChange(next => seen.push(next.batteryLow));
  f.send(state({ battery_low: true }));
  assert.deepEqual(seen, [true]); assert.deepEqual(errors, ['bug']);
});

test('a failed device subscription turns off only device state: DEVICE_NOT_SUPPORTED, init still works', async t => {
  const f = await fixture(t, { init: false });
  f.bridge.subscribeDevice = () => { throw Error('private'); };
  await f.sdk.init(); await f.sdk.init();
  assert.equal(f.sdk.getDevice(), null);
  assert.equal(f.sdk.supports('device_v1'), false);
  assert.throws(() => f.sdk.onDeviceChange(() => {}), { code: 'DEVICE_NOT_SUPPORTED' });
  f.scope.dispatchEvent(new Event('pagehide'));
  assert.throws(() => f.sdk.onDeviceChange(() => {}), { code: 'ACCESS_REVOKED' });
});
