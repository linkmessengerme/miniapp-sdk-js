import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { MessageChannel } from 'node:worker_threads';
import { installBrowserHost } from '../browser-host.js';
import { createSDK } from '../index.js';
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
