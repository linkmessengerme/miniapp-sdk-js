import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createSDK, MiniAppError } from '../index.js';
import { isShareParams, MAX_SHARE_TEXT } from '../share.js';

const ORIGIN = 'https://mini.example.com';

// A native-shaped host: share_v1 opens a picker that the test resolves.
function fixture({ capabilities = ['share_v1'], gesture } = {}) {
  const launch = { result: 'LAUNCH_RESULT_READY', launch_id: 'launch', ready: {
    app_id: 'app', sub: 'pairwise', environment: 'ENVIRONMENT_LIVE', expires_at: new Date(Date.now() + 60000).toISOString(),
    web: { id_token: 'proof', allowed_origins: [ORIGIN] } } };
  const packets = [];
  let answer = packet => ({ version: 1, request_id: packet.request_id, result: { outcome: 'shared' } });
  const bridge = { capabilities,
    async request(packet) {
      packets.push(packet);
      if (packet.method === 'init') return { version: 1, request_id: packet.request_id, result: structuredClone(launch) };
      if (packet.method === 'close') return { version: 1, request_id: packet.request_id, result: {} };
      return answer(packet);
    } };
  const scope = { crypto: webcrypto, location: new URL(ORIGIN), __LinkMiniAppHost: bridge };
  scope.top = scope;
  if (gesture !== undefined) scope.navigator = { userActivation: { get isActive() { return gesture(); } } };
  return { scope, bridge, launch, packets, sdk: createSDK(scope), answer: fn => { answer = fn; } };
}

const shares = packets => packets.filter(packet => packet.method === 'share');

test('share sends only start and text and returns only the outcome', async () => {
  const f = fixture();
  await f.sdk.init();
  assert.equal(f.sdk.supports('share_v1'), true);
  f.answer(packet => ({ version: 1, request_id: packet.request_id,
    result: { outcome: 'shared', chats: ['secret-chat'], recipients: 3 } }));
  const result = await f.sdk.share({ start: 'room.abc-1_2', text: 'Join my room\ncode 42' });
  assert.deepEqual(result, { outcome: 'shared' });
  assert.ok(Object.isFrozen(result));
  const [packet] = shares(f.packets);
  assert.deepEqual(packet.params, { start: 'room.abc-1_2', text: 'Join my room\ncode 42' });
  assert.equal(packet.version, 1);
  assert.equal(typeof packet.request_id, 'string');
  f.answer(packet => ({ version: 1, request_id: packet.request_id, result: { outcome: 'cancelled' } }));
  assert.deepEqual(await f.sdk.share(), { outcome: 'cancelled' });
  assert.deepEqual(shares(f.packets)[1].params, {});
});

test('share initialises first and works without an explicit init()', async () => {
  const f = fixture();
  assert.deepEqual(await f.sdk.share({ start: 'ep.42' }), { outcome: 'shared' });
  assert.deepEqual(f.packets.map(packet => packet.method), ['init', 'share']);
});

test('invalid options never reach the host', async () => {
  const f = fixture();
  await f.sdk.init();
  for (const options of [null, 'ep.42', [], { start: '' }, { start: 'a b' }, { start: 'https://evil.example/' },
    { start: 'ñandú' }, { start: 'a'.repeat(257) }, { start: 42 }, { text: '' }, { text: '   \n' },
    { text: 'a'.repeat(MAX_SHARE_TEXT + 1) }, { text: 'a\u0000b' }, { text: 'abc‮gpj.exe' }, { text: 'a⁦b' },
    { text: '\uD800' }, { text: 7 }, { url: 'https://evil.example/' }, { start: 'ok', chat: 'x' }]) {
    await assert.rejects(f.sdk.share(options), error => {
      assert.ok(error instanceof MiniAppError);
      assert.equal(error.code, 'INVALID_SHARE_REQUEST');
      return true;
    }, JSON.stringify(options));
  }
  assert.equal(shares(f.packets).length, 0);
  // Limits are inclusive; astral characters count once.
  await f.sdk.share({ start: 'a'.repeat(256), text: '😀'.repeat(MAX_SHARE_TEXT) });
  await f.sdk.share({ start: undefined, text: undefined });
  assert.deepEqual(shares(f.packets)[1].params, {});
});

test('without share_v1 nothing is sent', async () => {
  for (const capabilities of [[], ['back_v1', 'header_v1'], null]) {
    const f = fixture({ capabilities });
    await f.sdk.init();
    assert.equal(f.sdk.supports('share_v1'), false);
    await assert.rejects(f.sdk.share({ start: 'ep.1' }), { code: 'SHARE_NOT_SUPPORTED' });
    assert.equal(shares(f.packets).length, 0);
  }
});

test('one picker at a time', async () => {
  const f = fixture();
  await f.sdk.init();
  let resolve;
  f.answer(packet => new Promise(r => { resolve = () => r({ version: 1, request_id: packet.request_id, result: { outcome: 'shared' } }); }));
  const first = f.sdk.share({ start: 'a' });
  await new Promise(r => setTimeout(r, 0));
  await assert.rejects(f.sdk.share({ start: 'a' }), { code: 'SHARE_IN_PROGRESS' });
  resolve();
  assert.deepEqual(await first, { outcome: 'shared' });
  f.answer(packet => ({ version: 1, request_id: packet.request_id, result: { outcome: 'cancelled' } }));
  assert.deepEqual(await f.sdk.share({ start: 'a' }), { outcome: 'cancelled' });
});

test('share requires a user gesture where the browser reports one', async () => {
  let active = false;
  const f = fixture({ gesture: () => active });
  await f.sdk.init();
  await assert.rejects(f.sdk.share(), { code: 'USER_GESTURE_REQUIRED' });
  assert.equal(shares(f.packets).length, 0);
  active = true;
  assert.deepEqual(await f.sdk.share(), { outcome: 'shared' });
});

test('host errors keep their codes; malformed results do not reach the page', async () => {
  for (const code of ['SHARE_IN_PROGRESS', 'USER_GESTURE_REQUIRED', 'SHARE_NOT_SUPPORTED', 'ACCESS_REVOKED', 'FUTURE_CODE']) {
    const f = fixture(); await f.sdk.init();
    f.answer(packet => ({ version: 1, request_id: packet.request_id, error: { code } }));
    await assert.rejects(f.sdk.share(), { code });
  }
  for (const result of [undefined, {}, { outcome: 'sent' }, { outcome: true }, 'shared', []]) {
    const f = fixture(); await f.sdk.init();
    f.answer(packet => ({ version: 1, request_id: packet.request_id, result }));
    await assert.rejects(f.sdk.share(), { code: 'INVALID_HOST_RESPONSE' }, JSON.stringify(result));
  }
  const f = fixture(); await f.sdk.init();
  f.answer(() => Promise.reject(new Error('SHARE_IN_PROGRESS')));
  await assert.rejects(f.sdk.share(), { code: 'SHARE_IN_PROGRESS' });
  f.answer(() => Promise.reject(new Error('private details')));
  await assert.rejects(f.sdk.share(), { code: 'HOST_ERROR' });
});

test('closing, a subframe or another account withholds the result', async () => {
  const closedNow = fixture(); await closedNow.sdk.init(); await closedNow.sdk.close();
  await assert.rejects(closedNow.sdk.share(), { code: 'ACCESS_REVOKED' });

  const frame = fixture(); await frame.sdk.init(); frame.scope.top = {};
  await assert.rejects(frame.sdk.share(), { code: 'NOT_MAIN_FRAME' });

  const during = fixture(); await during.sdk.init();
  during.answer(packet => {
    during.scope.dispatchEvent?.(new Event('linkminiapp:closed'));
    return during.sdk.close().then(() => ({ version: 1, request_id: packet.request_id, result: { outcome: 'shared' } }));
  });
  await assert.rejects(during.sdk.share(), { code: 'ACCESS_REVOKED' });

  const swapped = fixture(); await swapped.sdk.init();
  swapped.answer(async packet => {
    swapped.launch.ready.sub = 'another-account';
    swapped.launch.launch_id = 'launch-2';
    await swapped.sdk.init();
    return { version: 1, request_id: packet.request_id, result: { outcome: 'shared' } };
  });
  await assert.rejects(swapped.sdk.share(), { code: 'ACCESS_REVOKED' });

  const refreshed = fixture(); await refreshed.sdk.init();
  refreshed.answer(async packet => {
    refreshed.launch.launch_id = 'launch-2';
    await refreshed.sdk.init();
    return { version: 1, request_id: packet.request_id, result: { outcome: 'shared' } };
  });
  assert.deepEqual(await refreshed.sdk.share(), { outcome: 'shared' });
});

test('host adapters validate wire params with the same rules', () => {
  assert.equal(isShareParams({}), true);
  assert.equal(isShareParams({ start: 'ep.1', text: 'Watch this' }), true);
  for (const params of [undefined, null, [], { start: undefined }, { start: 'a b' }, { text: '' }, { url: 'x' }]) {
    assert.equal(isShareParams(params), false, JSON.stringify(params));
  }
});
