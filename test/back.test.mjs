import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createSDK, MiniAppError } from '../index.js';
import { backHost } from './back-host.mjs';

const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function fixture(t, capabilities = ['back_v1']) {
  const scope = Object.assign(new EventTarget(), { crypto: webcrypto, location: new URL('https://mini.example') });
  scope.top = scope;
  let listener, closeCount = 0, subscriptions = 0;
  const calls = [], documentId = webcrypto.randomUUID();
  const launch = { result: 'LAUNCH_RESULT_READY', launch_id: 'launch', ready: {
    app_id: 'app', sub: 'user', environment: 'ENVIRONMENT_TEST', expires_at: new Date(Date.now() + 60000).toISOString(),
    web: { id_token: 'synthetic-proof', allowed_origins: [scope.location.origin] },
  } };
  const close = () => { closeCount++; scope.dispatchEvent(new Event('linkminiapp:closed')); };
  const host = backHost({ documentId, send: packet => listener?.(packet), close });
  const bridge = { documentId, capabilities,
    subscribeBack(fn) { subscriptions++; listener = fn; return () => { listener = undefined; }; },
    ackBack: packet => host.ack(packet),
    request(packet) {
      calls.push(packet);
      if (packet.method === 'close') { host.revoke(); close(); }
      return { version: 1, request_id: packet.request_id, result: packet.method === 'init' ? launch : {} };
    },
  };
  scope.__LinkMiniAppHost = bridge;
  const sdk = createSDK(scope);
  await sdk.init();
  t.after(() => { host.revoke(); scope.dispatchEvent(new Event('pagehide')); });
  return { sdk, host, scope, bridge, calls, launch,
    get closeCount() { return closeCount; }, get subscriptions() { return subscriptions; },
    event(id, changes) { return { version: 1, type: 'link-miniapp:back', document_id: documentId, event_id: id, ...changes }; },
    send(packet) { listener?.(packet); },
  };
}

test('Back closes a modal, pops one router entry, then closes the Mini App at root', async t => {
  const f = await fixture(t);
  let modal = true;
  const routes = ['/', '/details'];
  f.sdk.onBack(() => {
    if (modal) { modal = false; return true; }
    if (routes.length > 1) { routes.pop(); return true; }
    return false;
  });
  assert.equal(await f.host.back(), 'handled');
  assert.equal(modal, false); assert.equal(routes.length, 2); assert.equal(f.closeCount, 0);
  assert.equal(await f.host.back(), 'handled');
  assert.deepEqual(routes, ['/']); assert.equal(f.closeCount, 0);
  assert.equal(await f.host.back(), 'close'); assert.equal(f.closeCount, 1);
  assert.equal(f.calls.some(packet => packet.method === 'close'), false); // The host owns fallback.
  await assert.rejects(f.sdk.init(), { code: 'ACCESS_REVOKED' });
});

test('absence of a handler and an unsubscribed handler both close at root', async t => {
  for (const subscribe of [false, true]) {
    const f = await fixture(t);
    if (subscribe) { const off = f.sdk.onBack(() => { assert.fail('unsubscribed'); }); off(); off(); }
    assert.equal(await f.host.back(), 'close'); assert.equal(f.closeCount, 1);
  }
});

test('latest subscription wins across instances and unsubscribe restores the previous handler', async t => {
  const f = await fixture(t), second = createSDK(f.scope), seen = [];
  await second.init(); assert.equal(f.subscriptions, 1);
  const first = f.sdk.onBack(() => { seen.push('router'); return true; });
  const last = second.onBack(() => { seen.push('modal'); return true; });
  assert.equal(await f.host.back(), 'handled');
  last(); last();
  assert.equal(await f.host.back(), 'handled');
  assert.deepEqual(seen, ['modal', 'router']);
  first(); assert.equal(await f.host.back(), 'close');
});

test('capability, successful init and a complete host adapter are required', async t => {
  for (const capabilities of [[], ['payments_v1']]) {
    const f = await fixture(t, capabilities);
    assert.throws(() => f.sdk.onBack(() => true), { name: 'MiniAppError', code: 'BACK_NOT_SUPPORTED' });
    assert.equal(f.subscriptions, 0);
  }
  const f = await fixture(t);
  assert.throws(() => createSDK({}).onBack(() => true), { code: 'BACK_NOT_SUPPORTED' });
  assert.throws(() => f.sdk.onBack(undefined), { code: 'INVALID_BACK_HANDLER' });
  const scope = { ...f.scope, top: undefined, __LinkMiniAppHost: { capabilities: ['back_v1'], request: f.bridge.request },
    location: f.scope.location, crypto: webcrypto };
  scope.top = scope;
  const sdk = createSDK(scope); await sdk.init();
  assert.throws(() => sdk.onBack(() => true), { code: 'BACK_NOT_SUPPORTED' });
});

test('duplicates, coalesced taps and arbitrarily old event IDs never perform a second transition', async t => {
  const f = await fixture(t), waiting = deferred(); let calls = 0;
  f.sdk.onBack(() => { calls++; return calls === 1 ? waiting.promise : true; });
  const first = f.host.back();
  assert.equal(f.host.back(), first);
  f.host.retry(); await flush(); assert.equal(calls, 1);
  waiting.resolve(true); assert.equal(await first, 'handled');
  f.send(f.host.events[0]); await flush();
  assert.equal(calls, 1); assert.equal(f.host.acks.at(-1).action, 'handled');
  for (let i = 0; i < 40; i++) assert.equal(await f.host.back(), 'handled');
  f.send(f.host.events[0]); await flush(); assert.equal(calls, 41); assert.equal(f.closeCount, 0);
});

test('foreign documents, wrong versions and malformed or nonmonotonic IDs are ignored', async t => {
  const f = await fixture(t); let calls = 0;
  f.sdk.onBack(() => { calls++; return true; });
  for (const change of [{ version: 2 }, { type: 'other' }, { document_id: webcrypto.randomUUID() },
    ...[0, -1, 1.5, '1', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1].map(event_id => ({ event_id }))]) {
    f.send(f.event(1, change));
  }
  await flush(); assert.equal(calls, 0); assert.equal(f.host.acks.length, 0);
  assert.equal(await f.host.back(), 'handled'); assert.equal(calls, 1);
});

test('errors and invalid handler results keep the Mini App open and never leak error details', async t => {
  const f = await fixture(t);
  for (const handler of [() => { throw Error('private details'); }, () => Promise.reject(Error('private details')),
    () => undefined, () => 'true', () => ({ handled: true })]) {
    const off = f.sdk.onBack(handler);
    assert.equal(await f.host.back(), 'ignored'); off();
    assert.deepEqual(Object.keys(f.host.acks.at(-1)).sort(), ['action', 'document_id', 'event_id', 'type', 'version']);
  }
  assert.equal(f.closeCount, 0);
});

test('timeout aborts async work; late false and new events during the old handler cannot close or navigate', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = await fixture(t), waiting = deferred(); let calls = 0, signal;
  f.sdk.onBack(context => { calls++; signal = context.signal; return waiting.promise; });
  const first = f.host.back(); await flush();
  t.mock.timers.tick(999); assert.equal(signal.aborted, false);
  t.mock.timers.tick(1); assert.equal(await first, 'ignored'); assert.equal(signal.aborted, true);
  assert.equal(await f.host.back(), 'ignored'); assert.equal(calls, 1);
  const ackCount = f.host.acks.length;
  waiting.resolve(false); await flush();
  assert.equal(f.host.acks.length, ackCount); assert.equal(f.closeCount, 0);
  const off = f.sdk.onBack(() => true);
  assert.equal(await f.host.back(), 'handled'); off();
});

test('unsubscription cancels an in-flight handler without invoking the underlying router', async t => {
  const f = await fixture(t), waiting = deferred(); let signal, underlying = 0;
  f.sdk.onBack(() => { underlying++; return true; });
  const off = f.sdk.onBack(context => { signal = context.signal; return waiting.promise; });
  const pending = f.host.back(); await flush(); off();
  assert.equal(await pending, 'ignored'); assert.equal(signal.aborted, true);
  waiting.resolve(false); await flush(); assert.equal(f.closeCount, 0);
  assert.equal(await f.host.back(), 'handled'); assert.equal(underlying, 1);
});

test('elapsed deadlines win even when busy JavaScript has delayed the timer callback', async t => {
  const f = await fixture(t); let time = 0, signal;
  f.scope.performance = { now: () => time };
  f.sdk.onBack(context => { signal = context.signal; time = 1001; return false; });
  assert.equal(await f.host.back(), 'ignored'); assert.equal(f.closeCount, 0); assert.equal(signal.aborted, true);
  time = 0;
  const host = backHost({ documentId: webcrypto.randomUUID(), now: () => time,
    send() {}, close() { assert.fail('deadline cannot authorize close'); } });
  const pending = host.back(); time = 1501;
  host.ack({ ...host.events[0], type: 'link-miniapp:back-ack', action: 'close' });
  assert.equal(await pending, 'ignored'); host.revoke();
});

test('concurrent distinct events from a broken host are acknowledged without reentering the handler', async t => {
  const f = await fixture(t), waiting = deferred(); let calls = 0;
  f.sdk.onBack(() => { calls++; return waiting.promise; });
  f.send(f.event(1)); await flush(); f.send(f.event(2));
  assert.equal(f.host.acks.at(-1).action, 'ignored'); assert.equal(f.host.acks.at(-1).event_id, 2);
  waiting.resolve(true); await flush(); assert.equal(calls, 1);
  f.send(f.event(1)); f.send(f.event(2)); await flush(); assert.equal(calls, 1);
});

for (const event of ['linkminiapp:closed', 'pagehide', 'pageshow']) {
  test(`${event} aborts Back and discards late answers for the old document`, async t => {
    const f = await fixture(t), waiting = deferred(); let signal;
    f.sdk.onBack(context => { signal = context.signal; return waiting.promise; });
    f.send(f.event(1)); await flush();
    const message = new Event(event); if (event === 'pageshow') message.persisted = true;
    f.scope.dispatchEvent(message);
    assert.equal(signal.aborted, true); waiting.resolve(false); await flush();
    assert.equal(f.host.acks.length, 0); assert.equal(f.closeCount, 0);
    assert.throws(() => f.sdk.onBack(() => true), { code: 'ACCESS_REVOKED' });
    await assert.rejects(f.sdk.init(), { code: 'ACCESS_REVOKED' });
  });
}

test('bridge/origin/document/main-frame replacement prevents delivery to another document', async t => {
  for (const change of [f => { f.scope.__LinkMiniAppHost = { ...f.bridge }; },
    f => { f.scope.location = new URL('https://other.example'); }, f => { f.scope.top = {}; },
    f => { f.bridge.documentId = webcrypto.randomUUID(); }]) {
    const f = await fixture(t), waiting = deferred(); let signal;
    f.sdk.onBack(context => { signal = context.signal; return waiting.promise; });
    f.send(f.event(1)); await flush(); change(f); waiting.resolve(false); await flush();
    assert.equal(signal.aborted, true); assert.equal(f.host.acks.length, 0); assert.equal(f.closeCount, 0);
  }
});

test('renewed launches keep Back; changed identity invalidates the dispatcher', async t => {
  for (const key of ['sub', 'app_id', 'environment']) {
    const f = await fixture(t), waiting = deferred(); let signal;
    f.sdk.onBack(context => { signal = context.signal; return waiting.promise; });
    f.launch.launch_id = 'renewed'; await f.sdk.init(); assert.equal(f.subscriptions, 1);
    f.send(f.event(1)); await flush();
    f.launch.ready[key] = key === 'environment' ? 'ENVIRONMENT_LIVE' : 'changed';
    await assert.rejects(f.sdk.init(), { code: 'ACCESS_REVOKED' });
    assert.equal(signal.aborted, true); waiting.resolve(false); await flush();
    assert.equal(f.host.acks.length, 0);
  }
});

test('explicit SDK.close wins over pending Back, cancels it and closes only once', async t => {
  const f = await fixture(t), waiting = deferred(); let signal;
  f.sdk.onBack(context => { signal = context.signal; return waiting.promise; });
  const pending = f.host.back(); await flush();
  await f.sdk.close(); assert.equal(await pending, 'ignored'); assert.equal(signal.aborted, true);
  waiting.resolve(false); await flush(); assert.equal(f.host.acks.length, 0); assert.equal(f.closeCount, 1);
});

test('SDK.close from inside a Back handler closes the whole app without a second ack/pop', async t => {
  const f = await fixture(t);
  f.sdk.onBack(async () => { await f.sdk.close(); return false; });
  assert.equal(await f.host.back(), 'ignored'); await flush();
  assert.equal(f.closeCount, 1); assert.equal(f.host.acks.length, 0);
});

test('the host rejects stale/foreign acks and keeps the app open on its independent deadline', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let closeCount = 0;
  const host = backHost({ documentId: webcrypto.randomUUID(), send() {}, close() { closeCount++; } });
  const first = host.back(), packet = host.events[0];
  for (const change of [{ version: 2 }, { type: 'other' }, { document_id: webcrypto.randomUUID() }, { event_id: 2 }, { action: 'other' }]) {
    host.ack({ ...packet, type: 'link-miniapp:back-ack', action: 'close', ...change });
  }
  t.mock.timers.tick(1500); assert.equal(await first, 'ignored');
  const second = host.back();
  host.ack({ ...packet, type: 'link-miniapp:back-ack', action: 'close' });
  host.ack({ ...host.events[1], type: 'link-miniapp:back-ack', action: 'handled' });
  assert.equal(await second, 'handled'); assert.equal(closeCount, 0);
  host.revoke(); assert.equal(await host.back(), 'ignored');
});

test('a failing acknowledgement transport revokes Back without exposing native exceptions', async t => {
  for (const ackBack of [() => { throw Error('private'); }, () => Promise.reject(Error('private'))]) {
    const f = await fixture(t); f.bridge.ackBack = ackBack;
    f.sdk.onBack(() => true); f.send(f.event(1)); await flush();
    assert.throws(() => f.sdk.onBack(() => true), error => error instanceof MiniAppError && error.code === 'ACCESS_REVOKED');
    assert.equal(f.closeCount, 0);
  }
});
