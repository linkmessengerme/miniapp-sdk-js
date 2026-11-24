import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createSDK, MiniAppError } from '../index.js';
import { headerHost } from './header-host.mjs';

const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

async function fixture(t, { capabilities = ['back_v1', 'header_v1'], init = true } = {}) {
  const scope = Object.assign(new EventTarget(), { crypto: webcrypto, location: new URL('https://mini.example') });
  scope.top = scope;
  const errors = [];
  scope.reportError = error => errors.push(error);
  let listener, closeCount = 0, subscriptions = 0;
  const calls = [], documentId = webcrypto.randomUUID();
  const launch = { result: 'LAUNCH_RESULT_READY', launch_id: 'launch', ready: {
    app_id: 'app', sub: 'user', environment: 'ENVIRONMENT_TEST', expires_at: new Date(Date.now() + 60000).toISOString(),
    web: { id_token: 'synthetic-proof', allowed_origins: [scope.location.origin] },
  } };
  const close = () => { closeCount++; scope.dispatchEvent(new Event('linkminiapp:closed')); };
  const host = headerHost({ documentId, send: packet => listener?.(packet), close });
  const bridge = { documentId, capabilities,
    subscribeBack() { return () => {}; }, ackBack() {},
    subscribeHeader(fn) { subscriptions++; listener = fn; return () => { listener = undefined; }; },
    setHeaderState: packet => { host.apply(packet); },
    request(packet) {
      calls.push(packet);
      if (packet.method === 'close') close();
      if (packet.method === 'minimize') return { version: 1, request_id: packet.request_id, ...host.request('minimize') };
      return { version: 1, request_id: packet.request_id, result: packet.method === 'init' ? launch : {} };
    },
  };
  scope.__LinkMiniAppHost = bridge;
  const sdk = createSDK(scope);
  if (init) await sdk.init();
  t.after(() => scope.dispatchEvent(new Event('pagehide')));
  return { sdk, host, scope, bridge, calls, launch, errors, documentId,
    get closeCount() { return closeCount; }, get subscriptions() { return subscriptions; },
    get listening() { return listener !== undefined; },
    send(packet) { listener?.(packet); },
  };
}

test('defaults stay with the host until the page changes something', async t => {
  const f = await fixture(t);
  await flush();
  assert.equal(f.host.applied.length, 0);
  assert.deepEqual(f.host.view(), { left: 'auto', title: true, capsule: ['⋯', '⌄'],
    menu: ['Обновить', 'Поделиться', 'Скопировать ссылку', 'О приложении', 'Пожаловаться', 'Закрыть приложение'] });
});

test('calls in one task produce one packet with the whole state and an increasing revision', async t => {
  const f = await fixture(t);
  f.sdk.setBackButton('close');
  f.sdk.setCloseConfirmation(true);
  f.sdk.setHeaderStyle({ icons: 'light' });
  f.sdk.setMenuItems([{ id: 'settings', title: '  Настройки игры ', icon: 'settings' }, { id: 'rules', title: 'Правила' }]);
  await flush();
  assert.equal(f.host.applied.length, 1);
  assert.deepEqual(f.host.applied[0], { version: 1, type: 'link-miniapp:header-state', document_id: f.documentId,
    revision: 1, state: { back_button: 'close', close_confirmation: true, icons: 'light', title: 'shown', fullscreen: false, orientation: 'auto', sound_control: false,
      menu_items: [{ id: 'settings', title: 'Настройки игры', icon: 'settings' }, { id: 'rules', title: 'Правила' }] } });
  assert.ok(Object.isFrozen(f.host.applied[0]) && Object.isFrozen(f.host.applied[0].state));
  f.sdk.setFullscreen(true); await flush();
  assert.equal(f.host.applied[1].revision, 2);
  assert.equal(f.host.applied[1].state.close_confirmation, true); // Earlier settings are kept.
  f.sdk.setMenuItems([]); await flush();
  assert.deepEqual(f.host.state.menu_items, []);
});

test('own menu items come first; Link items always remain', async t => {
  const f = await fixture(t), picked = [];
  f.sdk.onMenuItem(id => picked.push(id));
  f.sdk.setMenuItems([{ id: 'sound', title: 'Звук', icon: 'sound' }]); await flush();
  assert.deepEqual(f.host.view().menu.slice(0, 2), ['Звук', 'Обновить']);
  assert.ok(f.host.view().menu.includes('Закрыть приложение'));
  f.host.tapMenu('Звук'); assert.deepEqual(picked, ['sound']);
  f.host.tapMenu('Закрыть приложение'); assert.equal(f.closeCount, 1);
});

test('every menu listener hears a pick; failing listeners are reported, not fatal', async t => {
  const f = await fixture(t), seen = [];
  f.sdk.setMenuItems([{ id: 'a', title: 'A' }]); await flush();
  const off = f.sdk.onMenuItem(id => seen.push(`first:${id}`));
  f.sdk.onMenuItem(() => { throw Error('application bug'); });
  f.sdk.onMenuItem(async () => { throw Error('async bug'); });
  f.sdk.onMenuItem(id => seen.push(`last:${id}`));
  f.host.tapMenu('A'); await flush();
  assert.deepEqual(seen, ['first:a', 'last:a']);
  assert.equal(f.errors.length, 2);
  off(); off();
  f.host.tapMenu('A');
  assert.deepEqual(seen, ['first:a', 'last:a', 'last:a']);
});

test('menu item validation', async t => {
  const f = await fixture(t);
  const bad = [undefined, null, {}, 'items', [null], [{ id: 'A', title: 'x' }], [{ id: '', title: 'x' }],
    [{ id: 'a'.repeat(33), title: 'x' }], [{ id: 'a b', title: 'x' }], [{ id: 'a', title: '' }],
    [{ id: 'a', title: '   ' }], [{ id: 'a', title: 'x'.repeat(33) }], [{ id: 'a', title: 'two\nlines' }],
    [{ id: 'a', title: 'evil\u202etxt' }], [{ id: 'a', title: 5 }], [{ id: 'a', title: 'x', icon: 'https://x/y.png' }],
    [{ id: 'a', title: 'x' }, { id: 'a', title: 'y' }], [{ id: 'a', title: ('a' + '\u0301'.repeat(200)).repeat(32) }],
    Array.from({ length: 6 }, (_, i) => ({ id: `i${i}`, title: `Item ${i}` }))];
  for (const items of bad) {
    assert.throws(() => f.sdk.setMenuItems(items), { name: 'MiniAppError', code: 'INVALID_MENU_ITEMS' });
  }
  // 32 user-perceived characters, emoji and combined letters included.
  f.sdk.setMenuItems([{ id: 'ok', title: '👍🏽'.repeat(32) }, { id: 'tk', title: 'Ýüzýän ŇŞÇ' }]); await flush();
  assert.equal(f.host.state.menu_items.length, 2);
  assert.equal(f.host.applied.length, 1);
});

test('a host drops items that pretend to be Link items and a stale pick is ignored', async t => {
  const f = await fixture(t), picked = [];
  f.sdk.onMenuItem(id => picked.push(id));
  f.sdk.setMenuItems([{ id: 'fake', title: 'Закрыть приложение' }, { id: 'real', title: 'Справка' }]); await flush();
  assert.deepEqual(f.host.state.menu_items.map(item => item.id), ['real']);
  const stale = f.host.tapMenu('Справка');
  f.sdk.setMenuItems([]); await flush();
  f.send({ ...stale, event_id: stale.event_id + 1 });
  assert.deepEqual(picked, ['real']);
});

test('back button modes, header style and fullscreen; close and minimize stay reachable', async t => {
  const f = await fixture(t);
  for (const mode of ['back', 'close', 'hidden', 'auto']) {
    f.sdk.setBackButton(mode); await flush();
    assert.equal(f.host.state.back_button, mode);
  }
  f.sdk.setBackButton('hidden'); await flush();
  assert.equal(f.host.view().left, null);
  assert.ok(f.host.view().menu.includes('Закрыть приложение'));
  assert.deepEqual(f.host.view().capsule, ['⋯', '⌄']);
  f.sdk.setFullscreen(true); await flush();
  assert.deepEqual(f.host.view(), { left: null, title: false, capsule: ['⋯', '✕'],
    menu: ['«App» · мини-приложение', 'Обновить', 'Поделиться', 'Скопировать ссылку', 'О приложении', 'Пожаловаться', 'Свернуть', 'Закрыть приложение'] });
  for (const orientation of ['landscape', 'portrait', 'auto']) {
    f.sdk.setOrientation(orientation); await flush(); assert.equal(f.host.state.orientation, orientation);
  }
  for (const icons of ['dark', 'light', 'auto']) { f.sdk.setHeaderStyle({ icons }); await flush(); assert.equal(f.host.state.icons, icons); }
  for (const call of [() => f.sdk.setBackButton('none'), () => f.sdk.setBackButton(undefined),
    () => f.sdk.setCloseConfirmation('yes'), () => f.sdk.setCloseConfirmation(1), () => f.sdk.setFullscreen(null),
    () => f.sdk.setHeaderStyle({ icons: 'red' }), () => f.sdk.setHeaderStyle({ icons: 'dark', color: '#000' }),
    () => f.sdk.setHeaderStyle(null), () => f.sdk.setHeaderStyle('dark'), () => f.sdk.setHeaderStyle({}),
    () => f.sdk.setHeaderStyle({ icons: undefined }), () => f.sdk.setHeaderStyle({ title: 'none' }), () => f.sdk.setHeaderStyle({ title: false }), () => f.sdk.setHeaderStyle({ title: 'hidden', name: 'Shop' }),
    () => f.sdk.setOrientation('landscape-left'), () => f.sdk.setOrientation(90)]) {
    assert.throws(call, { code: 'INVALID_HEADER_OPTION' });
  }
});

test('close confirmation asks on user closes only', async t => {
  const f = await fixture(t);
  f.sdk.setCloseConfirmation(true); await flush();
  assert.equal(f.host.minimize(), true); assert.equal(f.host.confirmations, 0);
  f.host.restore();
  assert.equal(f.host.userClose(() => false), false); assert.equal(f.closeCount, 0);
  assert.equal(f.host.confirmations, 1);
  await f.sdk.close(); // The page asked itself: no dialog.
  assert.equal(f.host.confirmations, 1); assert.equal(f.closeCount, 1);
});

test('minimize and restore events; minimize() asks the host', async t => {
  const f = await fixture(t), seen = [];
  f.sdk.onMinimize(() => seen.push('minimize'));
  const off = f.sdk.onRestore(() => seen.push('restore'));
  f.host.minimize(); f.host.restore();
  assert.deepEqual(seen, ['minimize', 'restore']);
  await f.sdk.minimize();
  assert.equal(f.calls.at(-1).method, 'minimize'); assert.equal(f.host.minimized, true);
  assert.deepEqual(seen, ['minimize', 'restore', 'minimize']);
  await assert.rejects(f.sdk.minimize(), { code: 'MINIMIZE_NOT_AVAILABLE' });
  off(); f.host.restore();
  assert.deepEqual(seen, ['minimize', 'restore', 'minimize']);
  assert.throws(() => f.sdk.onMinimize('listener'), { code: 'INVALID_HEADER_LISTENER' });
});

test('old hosts and calls before init() throw HEADER_NOT_SUPPORTED and send nothing', async t => {
  const calls = sdk => [() => sdk.setBackButton('close'), () => sdk.setCloseConfirmation(true),
    () => sdk.setMenuItems([]), () => sdk.setHeaderStyle({ icons: 'dark' }), () => sdk.setFullscreen(true),
    () => sdk.setOrientation('landscape'), () => sdk.setSoundControl(true), () => sdk.onPause(() => {}),
    () => sdk.onResume(() => {}), () => sdk.onSoundChange(() => {}), () => sdk.onClosing(() => {}), () => sdk.onMenuItem(() => {}), () => sdk.onMinimize(() => {}), () => sdk.onRestore(() => {})];
  for (const capabilities of [[], ['back_v1'], ['payments_v1']]) {
    const f = await fixture(t, { capabilities });
    for (const call of calls(f.sdk)) assert.throws(call, { name: 'MiniAppError', code: 'HEADER_NOT_SUPPORTED' });
    await assert.rejects(f.sdk.minimize(), { code: 'HEADER_NOT_SUPPORTED' });
    assert.equal(f.subscriptions, 0); assert.equal(f.calls.some(packet => packet.method === 'minimize'), false);
  }
  const early = await fixture(t, { init: false });
  for (const call of calls(early.sdk)) assert.throws(call, { code: 'HEADER_NOT_SUPPORTED' });
  assert.throws(() => createSDK({}).setFullscreen(true), { code: 'HEADER_NOT_SUPPORTED' });
  // An incomplete adapter is treated as an old host.
  const partial = await fixture(t, { init: false });
  delete partial.bridge.setHeaderState; await partial.sdk.init();
  assert.throws(() => partial.sdk.setFullscreen(true), { code: 'HEADER_NOT_SUPPORTED' });
});

test('one header per document across SDK instances; one host subscription', async t => {
  const f = await fixture(t), second = createSDK(f.scope), seen = [];
  await second.init();
  assert.equal(f.subscriptions, 1);
  f.sdk.setBackButton('close'); second.setFullscreen(true); await flush();
  assert.equal(f.host.applied.length, 1);
  assert.deepEqual([f.host.state.back_button, f.host.state.fullscreen], ['close', true]);
  f.sdk.onMinimize(() => seen.push(1)); second.onMinimize(() => seen.push(2));
  f.host.minimize(); assert.deepEqual(seen, [1, 2]);
});

test('foreign, malformed, repeated and old events are ignored', async t => {
  const f = await fixture(t), seen = [];
  f.sdk.setMenuItems([{ id: 'a', title: 'A' }]); await flush();
  f.sdk.onMenuItem(id => seen.push(id)); f.sdk.onMinimize(() => seen.push('min'));
  const base = { version: 1, type: 'link-miniapp:header-event', document_id: f.documentId, event: 'minimize' };
  for (const change of [{ version: 2 }, { type: 'link-miniapp:back' }, { document_id: webcrypto.randomUUID() },
    { event: 'close' }, { event: 'menu_item' }, { event: 'menu_item', item_id: 'A B' }, { item_id: 'a' },
    ...[0, -1, 1.5, '1', NaN, Number.MAX_SAFE_INTEGER + 1].map(event_id => ({ event_id }))]) {
    f.send({ event_id: 1, ...base, ...change });
  }
  assert.deepEqual(seen, []);
  f.send({ ...base, event_id: 5 }); f.send({ ...base, event_id: 5 }); f.send({ ...base, event_id: 3 });
  f.send({ ...base, event: 'menu_item', item_id: 'a', event_id: 6 });
  assert.deepEqual(seen, ['min', 'a']);
});

for (const event of ['linkminiapp:closed', 'pagehide', 'pageshow']) {
  test(`${event} ends the header for this document`, async t => {
    const f = await fixture(t);
    f.sdk.setFullscreen(true);
    const message = new Event(event); if (event === 'pageshow') message.persisted = true;
    f.scope.dispatchEvent(message);
    await flush();
    assert.equal(f.host.applied.length, 0); // The pending change is dropped too.
    assert.equal(f.listening, false);
    assert.throws(() => f.sdk.setFullscreen(false), { code: 'ACCESS_REVOKED' });
    assert.throws(() => f.sdk.onMinimize(() => {}), { code: 'ACCESS_REVOKED' });
  });
}

test('replaced bridge, origin, document or frame stops the header', async t => {
  for (const change of [f => { f.scope.__LinkMiniAppHost = { ...f.bridge }; },
    f => { f.scope.location = new URL('https://other.example'); }, f => { f.scope.top = {}; },
    f => { f.bridge.documentId = webcrypto.randomUUID(); }]) {
    const f = await fixture(t);
    f.sdk.setFullscreen(true); change(f); await flush();
    assert.equal(f.host.applied.length, 0);
    assert.throws(() => f.sdk.setFullscreen(false), { code: 'ACCESS_REVOKED' });
  }
});

test('a renewed launch keeps the header; a changed identity stops it', async t => {
  const f = await fixture(t);
  f.launch.launch_id = 'renewed'; await f.sdk.init();
  assert.equal(f.subscriptions, 1);
  f.sdk.setFullscreen(true); await flush(); assert.equal(f.host.applied.length, 1);
  f.launch.ready.sub = 'someone-else';
  await assert.rejects(f.sdk.init(), { code: 'ACCESS_REVOKED' });
  assert.throws(() => f.sdk.setFullscreen(false), { code: 'ACCESS_REVOKED' });
});

test('SDK.close stops the header; a failing transport revokes without leaking details', async t => {
  const f = await fixture(t);
  await f.sdk.close();
  assert.throws(() => f.sdk.setBackButton('close'), { code: 'ACCESS_REVOKED' });
  await assert.rejects(f.sdk.minimize(), { code: 'ACCESS_REVOKED' });
  for (const setHeaderState of [() => { throw Error('private'); }, () => Promise.reject(Error('private'))]) {
    const g = await fixture(t); g.bridge.setHeaderState = setHeaderState;
    g.sdk.setFullscreen(true); await flush();
    assert.throws(() => g.sdk.setFullscreen(false), error => error instanceof MiniAppError && error.code === 'ACCESS_REVOKED');
    assert.equal(g.closeCount, 0);
  }
});

test('the reference host rejects old revisions, foreign documents and broken state', async t => {
  const documentId = webcrypto.randomUUID(), host = headerHost({ documentId });
  const packet = (revision, state = {}) => ({ version: 1, type: 'link-miniapp:header-state', document_id: documentId,
    revision, state: { back_button: 'auto', close_confirmation: false, menu_items: [], icons: 'auto', title: 'shown', fullscreen: false,
      orientation: 'auto', sound_control: false, ...state } });
  assert.equal(host.apply(packet(2, { fullscreen: true })), true);
  assert.equal(host.apply(packet(1, { fullscreen: false })), false);
  assert.equal(host.apply(packet(2, { fullscreen: false })), false);
  for (const state of [{ back_button: 'none' }, { icons: '#000' }, { title: 'Shop' }, { close_confirmation: 'yes' }, { orientation: 'upside-down' },
    { menu_items: Array.from({ length: 6 }, (_, i) => ({ id: `i${i}`, title: 'x' })) }]) {
    assert.equal(host.apply(packet(3, state)), false);
  }
  assert.equal(host.apply({ ...packet(3), document_id: webcrypto.randomUUID() }), false);
  assert.equal(host.state.fullscreen, true);
  host.apply(packet(3, { menu_items: [{ id: 'x', title: 'X', icon: 'from-a-newer-sdk' }] }));
  assert.deepEqual(host.state.menu_items, [{ id: 'x', title: 'X' }]);
  host.navigate(webcrypto.randomUUID());
  assert.equal(host.state.fullscreen, false); assert.equal(host.revision, 0);
});

test('the title can be removed; Link keeps the name at the top of the menu', async t => {
  const f = await fixture(t);
  f.sdk.setHeaderStyle({ icons: 'light' }); await flush();
  f.sdk.setHeaderStyle({ title: 'hidden' }); await flush();
  assert.deepEqual([f.host.state.icons, f.host.state.title], ['light', 'hidden']); // icons kept
  assert.equal(f.host.view().title, false);
  assert.equal(f.host.view().menu[0], '«App» · мини-приложение');
  assert.ok(f.host.view().menu.includes('Закрыть приложение'));
  f.sdk.setBackButton('hidden'); await flush();
  assert.deepEqual([f.host.view().left, f.host.view().capsule], [null, ['⋯', '⌄']]); // close and minimize stay
  f.sdk.setHeaderStyle({ title: 'shown' }); await flush();
  assert.equal(f.host.view().title, true);
});

test('identical states are not sent again; the whole state stays far below 8 KiB', async t => {
  const f = await fixture(t);
  for (let i = 0; i < 10; i++) { f.sdk.setHeaderStyle({ icons: 'dark' }); await flush(); }
  for (let i = 0; i < 3; i++) { f.sdk.setMenuItems([{ id: 'a', title: 'A' }]); await flush(); }
  assert.equal(f.host.applied.length, 2);
  f.sdk.setHeaderStyle({ icons: 'auto' }); f.sdk.setMenuItems([]); await flush(); // back to defaults
  assert.equal(f.host.applied.length, 3);
  f.sdk.setHeaderStyle({ icons: 'auto' }); await flush();
  assert.equal(f.host.applied.length, 3);
  const longest = Array.from({ length: 5 }, (_, i) => ({ id: 'x'.repeat(31) + i, title: ('a' + '\u0301'.repeat(3)).repeat(32), icon: 'restart' }));
  f.sdk.setMenuItems(longest); f.sdk.setBackButton('hidden'); f.sdk.setHeaderStyle({ icons: 'light', title: 'hidden' });
  f.sdk.setFullscreen(true); f.sdk.setOrientation('landscape'); await flush();
  assert.ok(new TextEncoder().encode(JSON.stringify(f.host.applied.at(-1))).length < 8192);
});

test('a broken header transport turns off only the header; init still works', async t => {
  const f = await fixture(t, { init: false });
  f.bridge.subscribeHeader = () => { throw Error('private'); };
  await f.sdk.init();
  await f.sdk.init();
  assert.throws(() => f.sdk.setFullscreen(true), { code: 'ACCESS_REVOKED' });
  assert.equal(f.closeCount, 0);
});

test('a listener removed by an earlier listener is not called for that event', async t => {
  const f = await fixture(t), seen = [];
  let offSecond;
  f.sdk.onMinimize(() => { seen.push(1); offSecond(); });
  offSecond = f.sdk.onMinimize(() => seen.push(2));
  f.host.minimize();
  assert.deepEqual(seen, [1]);
});

test('pause and resume carry the reason once; minimize is followed by pause', async t => {
  const f = await fixture(t), seen = [];
  f.sdk.onPause(reason => seen.push(`pause:${reason}`));
  f.sdk.onResume(() => seen.push('resume'));
  f.sdk.onMinimize(() => seen.push('minimize'));
  assert.equal(f.sdk.isPaused(), false);
  f.host.openMenu(); assert.equal(f.sdk.isPaused(), true);
  f.host.closeMenu();
  f.host.minimize(); f.host.pause('locked'); f.host.resume('locked'); f.host.restore();
  assert.deepEqual(seen, ['pause:overlay', 'resume', 'minimize', 'pause:minimized', 'resume']);
  // A broken host repeating pause does not pause twice.
  const base = { version: 1, type: 'link-miniapp:header-event', document_id: f.documentId };
  f.send({ ...base, event_id: 100, event: 'pause', reason: 'background' });
  f.send({ ...base, event_id: 101, event: 'pause', reason: 'interrupted' });
  f.send({ ...base, event_id: 102, event: 'pause', reason: 'nap' });
  assert.deepEqual(seen.slice(5), ['pause:background']);
});

test('sound: the Link mute item appears only on request and the page learns the remembered choice', async t => {
  const f = await fixture(t), seen = [];
  f.sdk.onSoundChange(muted => seen.push(muted));
  assert.equal(f.host.view().menu.includes('Без звука'), false);
  f.host.event('sound', { muted: true }); // not asked for: ignored
  assert.deepEqual(seen, []); assert.equal(f.sdk.isMuted(), false);
  f.sdk.setSoundControl(true); await flush();
  assert.deepEqual(seen, []); // remembered choice: sound on — no change, so nothing reported
  assert.ok(f.host.view().menu.includes('Без звука'));
  f.host.tapMenu('Без звука');
  assert.deepEqual(seen, [true]); assert.equal(f.sdk.isMuted(), true);
  assert.ok(f.host.view().menu.includes('Включить звук'));
  f.host.tapMenu('Включить звук');
  assert.deepEqual(seen, [true, false]);
  f.sdk.setSoundControl(false); await flush();
  assert.equal(f.sdk.isMuted(), false);
  assert.throws(() => f.sdk.setSoundControl('yes'), { code: 'INVALID_HEADER_OPTION' });
});

test('closing comes before the app closes, with the reason; LinkMiniApp.close() sends none', async t => {
  for (const [reason, act] of [['user', h => h.userClose()], ['evicted', h => h.end('evicted')], ['revoked', h => h.end('revoked')]]) {
    const f = await fixture(t), seen = [];
    f.sdk.onClosing(r => seen.push([r, f.closeCount]));
    act(f.host);
    assert.deepEqual(seen, [[reason, 0]]); assert.equal(f.closeCount, 1);
  }
  const g = await fixture(t), seen = [];
  g.sdk.onClosing(r => seen.push(r));
  await g.sdk.close();
  assert.deepEqual(seen, []);
});
