import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { MessageChannel } from 'node:worker_threads';
import { installBrowserHost } from '../browser-host.js';
import { createSDK } from '../index.js';
import { backHost } from './back-host.mjs';

const CHECKOUT_ID = '22222222-2222-4222-8222-222222222222';
function scopeFixture() {
  const listeners = new Map(), sent = [], events = [];
  const scope = { crypto: { randomUUID }, CustomEvent: class { constructor(type) { this.type = type; } },
    addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); },
    removeEventListener(name, fn) { listeners.get(name)?.delete(fn); },
    dispatchEvent(event) { events.push(event); for (const fn of [...(listeners.get(event.type) || [])]) fn(event); },
    opener: { postMessage(...args) { sent.push(args); } } };
  scope.top = scope;
  return { scope, sent, events, emit(type, values = {}) { scope.dispatchEvent({ type, ...values }); } };
}

async function backConnection(t, capabilities = ['back_v1']) {
  const f = paymentConnection(t, capabilities);
  f.scope.location = new URL('https://mini.example');
  const host = backHost({ documentId: f.sent[0][0].nonce,
    send: packet => f.port.postMessage(packet),
    close: () => f.port.postMessage({ type: 'link-miniapp:revoked' }),
  });
  t.after(() => host.revoke());
  f.port.on('message', packet => {
    if (packet.type === 'link-miniapp:back-ack') { host.ack(packet); return; }
    f.port.postMessage({ version: 1, request_id: packet.request_id, result: packet.method === 'init' ? {
      result: 'LAUNCH_RESULT_READY', launch_id: 'launch', ready: {
        app_id: 'app', sub: 'user', environment: 'ENVIRONMENT_TEST',
        expires_at: new Date(Date.now() + 60000).toISOString(),
        web: { id_token: 'synthetic-proof', allowed_origins: [f.scope.location.origin] },
      },
    } : {} });
  });
  const sdk = createSDK(f.scope);
  await sdk.init();
  return { ...f, host, sdk };
}

test('Back event/ack use the authenticated document port; modal, router and root round-trip', async t => {
  const f = await backConnection(t); let modal = true, routes = 1;
  f.sdk.onBack(() => {
    if (modal) { modal = false; return true; }
    if (routes > 0) { routes--; return true; }
    return false;
  });
  assert.equal(f.bridge.documentId, f.sent[0][0].nonce);
  assert.equal(await f.host.back(), 'handled'); assert.equal(modal, false); assert.equal(routes, 1);
  assert.equal(await f.host.back(), 'handled'); assert.equal(routes, 0);
  const stopped = new Promise(resolve => f.scope.addEventListener('linkminiapp:closed', resolve));
  assert.equal(await f.host.back(), 'close'); await stopped;
  assert.equal(f.sent.length, 1); // No Back data travels through window.postMessage.
  await assert.rejects(f.sdk.init(), { code: 'ACCESS_REVOKED' });
});

test('window messages and forged document packets cannot trigger Back; malformed acks never leave the adapter', async t => {
  const f = await backConnection(t); let calls = 0;
  f.sdk.onBack(() => { calls++; return true; });
  const packet = { version: 1, type: 'link-miniapp:back', document_id: f.bridge.documentId, event_id: 1 };
  f.emit('message', { source: f.scope.opener, origin: 'https://host.example', data: packet });
  f.port.postMessage({ ...packet, document_id: randomUUID() });
  f.port.postMessage({ ...packet, version: 2 });
  f.port.postMessage({ ...packet, event_id: '1' });
  for (const change of [{ document_id: randomUUID() }, { version: 2 }, { event_id: 0 }, { action: true }]) {
    assert.throws(() => f.bridge.ackBack({ ...packet, type: 'link-miniapp:back-ack', action: 'close', ...change }), /INVALID_BACK_ACK/);
  }
  assert.equal(await f.host.back(), 'handled'); assert.equal(calls, 1); assert.equal(f.host.acks.length, 1);
});

test('duplicate port events acknowledge the same transition once; older hosts do not enable Back', async t => {
  const f = await backConnection(t); let calls = 0, finish;
  f.sdk.onBack(() => { calls++; return new Promise(resolve => { finish = resolve; }); });
  const pending = f.host.back(); f.host.retry();
  // A round trip after the events is a delivery barrier for this real MessagePort.
  await f.sdk.init();
  assert.equal(calls, 1); finish(true); assert.equal(await pending, 'handled');
  const replayAck = once(f.port, 'message'); f.port.postMessage(f.host.events[0]);
  assert.equal((await replayAck)[0].action, 'handled'); assert.equal(calls, 1);
  const old = await backConnection(t, []);
  assert.throws(() => old.sdk.onBack(() => true), { code: 'BACK_NOT_SUPPORTED' });
  assert.throws(() => old.bridge.subscribeBack(() => {}), /BACK_NOT_SUPPORTED/);
});

test('revocation and navigation close the document port before any late Back acknowledgement', async t => {
  for (const revoke of [f => f.port.postMessage({ type: 'link-miniapp:revoked' }), f => f.emit('pagehide')]) {
    const f = await backConnection(t); let finish, signal;
    f.sdk.onBack(context => { signal = context.signal; return new Promise(resolve => { finish = resolve; }); });
    const pending = f.host.back(); await f.sdk.init();
    const stopped = new Promise(resolve => f.scope.addEventListener('linkminiapp:closed', resolve));
    revoke(f); await stopped; f.host.revoke(); assert.equal(await pending, 'ignored');
    assert.equal(signal.aborted, true); finish(false);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.host.acks.length, 0);
    assert.throws(() => f.bridge.ackBack({ ...f.host.events[0], type: 'link-miniapp:back-ack', action: 'close' }), /ACCESS_REVOKED/);
  }
});
test('browser adapter is opt-in and never overrides native bridge or enables iframes', () => {
  const f = scopeFixture(); f.scope.__LinkMiniAppHost = { native: true }; assert.equal(installBrowserHost(f.scope, { hostOrigin: 'http://localhost:3008' }), false);
  const g = scopeFixture(); g.scope.top = {}; assert.equal(installBrowserHost(g.scope, { hostOrigin: 'http://localhost:3008' }), false);
  const h = scopeFixture(); h.scope.opener = null; assert.equal(installBrowserHost(h.scope, { hostOrigin: 'http://localhost:3008' }), false);
  assert.throws(() => installBrowserHost(scopeFixture().scope, { hostOrigin: 'http://remote.example' }), /INVALID_HOST_ORIGIN/);
});
test('handshake requires exact opener, trusted origin and nonce; credentials use the document port', async t => {
  const f = scopeFixture(); assert.equal(installBrowserHost(f.scope, { hostOrigin: 'http://localhost:3008' }), true);
  t.after(() => f.emit('pagehide'));
  assert.equal(f.sent.length, 1); assert.equal(f.sent[0][1], 'http://localhost:3008');
  const hello = f.sent[0][0]; assert.deepEqual(Object.keys(hello).sort(), ['nonce', 'type', 'version']);
  const valid = { source: f.scope.opener, origin: 'http://localhost:3008', data: { type: 'link-miniapp:connected', version: 1, nonce: hello.nonce } };
  for (const bad of [{ source: {} }, { origin: 'https://evil.example' }, { data: { ...valid.data, nonce: randomUUID() } }]) {
    const c = new MessageChannel(); f.emit('message', { ...valid, ports: [c.port1], ...bad });
    c.port1.close(); c.port2.close();
  }
  const channel = new MessageChannel(); t.after(() => channel.port2.close());
  f.emit('message', { ...valid, ports: [channel.port1] });
  const response = f.scope.__LinkMiniAppHost.request({ version: 1, method: 'init', request_id: randomUUID(), token: 'must-not-forward' });
  const [packet] = await once(channel.port2, 'message'); assert.equal(packet.token, undefined); assert.equal(packet.method, 'init');
  channel.port2.postMessage({ version: 1, request_id: packet.request_id, result: { ready: { expires_at: new Date(Date.now() + 60_000).toISOString(), web: { id_token: 'scoped-proof' } } } });
  assert.equal((await response).result.ready.web.id_token, 'scoped-proof'); assert.equal(f.sent.length, 1);
  channel.port2.postMessage({ type: 'link-miniapp:revoked' });
  await new Promise(resolve => setTimeout(resolve, 10));
  await assert.rejects(f.scope.__LinkMiniAppHost.request({ version: 1, method: 'init', request_id: randomUUID() }), /ACCESS_REVOKED/);
  assert.ok(f.events.some(e => e.type === 'linkminiapp:closed'));
});
test('an expired launch token does not close the document channel; the host reissues it', async t => {
  const f = scopeFixture(); installBrowserHost(f.scope, { hostOrigin: 'http://localhost:3008' }); t.after(() => f.emit('pagehide'));
  const c = new MessageChannel(); t.after(() => c.port2.close());
  f.emit('message', { source: f.scope.opener, origin: 'http://localhost:3008', data: { type: 'link-miniapp:connected', version: 1, nonce: f.sent[0][0].nonce }, ports: [c.port1] });
  let launch = 0;
  c.port2.on('message', packet => c.port2.postMessage({ version: 1, request_id: packet.request_id, result: { launch_id: `launch-${++launch}`, ready: { expires_at: new Date(Date.now() + (launch === 1 ? 1 : 60_000)).toISOString() } } }));
  assert.equal((await f.scope.__LinkMiniAppHost.request({ version: 1, method: 'init', request_id: randomUUID() })).result.launch_id, 'launch-1');
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal((await f.scope.__LinkMiniAppHost.request({ version: 1, method: 'init', request_id: randomUUID() })).result.launch_id, 'launch-2');
  assert.ok(!f.events.some(e => e.type === 'linkminiapp:closed'));
});
test('adapter revocation rejects an in-flight SDK UserInfo response and future calls', async t => {
  const f = scopeFixture();
  f.scope.location = new URL('https://mini.example');
  let begin, release;
  const started = new Promise(resolve => begin = resolve);
  f.scope.fetch = url => new Promise(resolve => {
    release = () => {
      const response = Response.json({ sub: 'fixture-sub', profile: { name: 'Must be discarded' } });
      Object.defineProperty(response, 'url', { value: url }); resolve(response);
    };
    begin();
  });
  const sdk = createSDK(f.scope);
  installBrowserHost(f.scope, { hostOrigin: 'http://localhost:3008' });
  t.after(() => f.emit('pagehide'));
  const c = new MessageChannel(); t.after(() => c.port2.close());
  f.emit('message', { source: f.scope.opener, origin: 'http://localhost:3008', data: {
    type: 'link-miniapp:connected', version: 1, nonce: f.sent[0][0].nonce,
  }, ports: [c.port1] });
  c.port2.on('message', packet => c.port2.postMessage({ version: 1, request_id: packet.request_id, result: {
    result: 'LAUNCH_RESULT_READY', launch_id: 'fixture-launch', ready: {
      app_id: 'fixture-app', sub: 'fixture-sub', environment: 'ENVIRONMENT_LIVE', scopes: ['profile'],
      expires_at: new Date(Date.now() + 60_000).toISOString(), access_token: `ma_${'x'.repeat(43)}`,
      web: { id_token: 'fixture.proof.signature', allowed_origins: [f.scope.location.origin] },
    },
  } }));
  const pending = sdk.getUserInfo();
  await started;
  const stopped = new Promise(resolve => f.scope.addEventListener('linkminiapp:closed', resolve));
  c.port2.postMessage({ type: 'link-miniapp:revoked' });
  await stopped; release();
  await assert.rejects(pending, { code: 'ACCESS_REVOKED' });
  await assert.rejects(sdk.init(), { code: 'ACCESS_REVOKED' });
  await assert.rejects(sdk.getUserInfo(), { code: 'ACCESS_REVOKED' });
});

function paymentConnection(t, capabilities = ['payments_v1']) {
  const f = scopeFixture();
  installBrowserHost(f.scope, { hostOrigin: 'https://host.example' });
  t.after(() => f.emit('pagehide'));
  const c = new MessageChannel(); t.after(() => c.port2.close());
  f.emit('message', { source: f.scope.opener, origin: 'https://host.example', data: {
    type: 'link-miniapp:connected', version: 1, nonce: f.sent[0][0].nonce, capabilities,
  }, ports: [c.port1] });
  return { ...f, port: c.port2, bridge: f.scope.__LinkMiniAppHost };
}
const paymentPacket = () => ({ version: 1, request_id: randomUUID(), method: 'pay',
  params: { checkout_session_id: CHECKOUT_ID } });

test('payments capability comes from the authenticated handshake; pay forwards only the checkout ID', async t => {
  const capabilities = ['payments_v1'];
  const f = paymentConnection(t, capabilities);
  capabilities.push('unexpected');
  assert.deepEqual(f.bridge.capabilities, ['payments_v1']);
  assert.ok(Object.isFrozen(f.bridge.capabilities));
  const packet = paymentPacket();
  const pending = f.bridge.request({ ...packet, token: 'secret', origin: 'https://evil.example' });
  const [sent] = await once(f.port, 'message');
  assert.deepEqual(sent, packet);
  const result = { order_id: '11111111-1111-4111-8111-111111111111', outcome: 'dismissed',
    payment_state: 'ORDER_STATUS_PROCESSING', fulfillment_state: 'FULFILLMENT_STATUS_NOT_REQUESTED' };
  f.port.postMessage({ version: 1, request_id: sent.request_id, result });
  assert.deepEqual((await pending).result, result);
  assert.equal(f.sent.length, 1); // Payment data never uses broadcast postMessage.
});

test('old browser hosts do not receive payment packets', async t => {
  const f = paymentConnection(t, []);
  await assert.rejects(f.bridge.request(paymentPacket()), /PAYMENTS_NOT_SUPPORTED/);
  assert.deepEqual(f.bridge.capabilities, []);
});

test('mutating a queued packet cannot bypass the capability check during handshake', async t => {
  const f = scopeFixture();
  installBrowserHost(f.scope, { hostOrigin: 'https://host.example' });
  t.after(() => f.emit('pagehide'));
  const c = new MessageChannel(); t.after(() => c.port2.close());
  const packet = paymentPacket();
  const pending = f.scope.__LinkMiniAppHost.request(packet);
  const rejected = assert.rejects(pending, /PAYMENTS_NOT_SUPPORTED/);
  packet.method = 'init'; packet.request_id = randomUUID();
  f.emit('message', { source: f.scope.opener, origin: 'https://host.example', data: {
    type: 'link-miniapp:connected', version: 1, nonce: f.sent[0][0].nonce,
  }, ports: [c.port1] });
  await rejected;
});

test('invalid payment parameters are rejected without forwarding identity or price', async t => {
  const f = paymentConnection(t);
  for (const params of [undefined, null, [], {}, { checkout_session_id: 1 },
    { checkout_session_id: 'not-a-uuid' }, { checkout_session_id: '00000000-0000-0000-0000-000000000000' },
    { checkout_session_id: CHECKOUT_ID, amount: '100' }, { checkout_session_id: CHECKOUT_ID, otp: 'secret' }]) {
    await assert.rejects(f.bridge.request({ ...paymentPacket(), params }), /INVALID_PAYMENT_REQUEST/);
  }
});

test('a malformed capability list closes the browser bridge', async t => {
  for (const capabilities of ['payments_v1', [42], ['INVALID'], Array(33).fill('payments_v1')]) {
    const f = paymentConnection(t, capabilities);
    await assert.rejects(f.bridge.request(paymentPacket()), /ACCESS_REVOKED/);
  }
});

test('payment wait outlives the short request timeout and remains bound to its request ID', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = paymentConnection(t);
  let settled = false;
  const pending = f.bridge.request(paymentPacket()).then(value => { settled = true; return value; });
  const [sent] = await once(f.port, 'message');
  t.mock.timers.tick(15000); await Promise.resolve();
  assert.equal(settled, false);
  f.port.postMessage({ version: 1, request_id: randomUUID(), result: { invalid: true } });
  f.port.postMessage({ version: 1, request_id: sent.request_id, result: { outcome: 'dismissed' } });
  assert.equal((await pending).result.outcome, 'dismissed');
});

test('close acknowledgment rejects pending payments and revokes the document channel', async t => {
  const f = paymentConnection(t);
  const payment = f.bridge.request(paymentPacket());
  const rejected = assert.rejects(payment, /ACCESS_REVOKED/);
  await once(f.port, 'message');
  const closing = f.bridge.request({ version: 1, request_id: randomUUID(), method: 'close' });
  const [sent] = await once(f.port, 'message');
  f.port.postMessage({ version: 1, request_id: sent.request_id, result: {} });
  await closing; await rejected;
  assert.ok(f.events.some(event => event.type === 'linkminiapp:closed'));
  await assert.rejects(f.bridge.request(paymentPacket()), /ACCESS_REVOKED/);
});
