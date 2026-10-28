// One dispatcher per document, shared by the default and createSDK instances.
// Host event IDs increase within a document, so old replays need no unbounded cache.
export const BACK_CAPABILITY = 'back_v1';
export const BACK_TIMEOUT_MS = 1000;
const documents = new WeakMap();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const validDocumentId = value => typeof value === 'string' && UUID.test(value) &&
  value !== '00000000-0000-0000-0000-000000000000';
const validEnvelope = (packet, documentId) => packet?.version === 1 &&
  packet.document_id === documentId && Number.isSafeInteger(packet.event_id) && packet.event_id > 0;
export const isBackEvent = (packet, documentId) => validEnvelope(packet, documentId) && packet.type === 'link-miniapp:back';
export const isBackAck = (packet, documentId) => validEnvelope(packet, documentId) &&
  packet.type === 'link-miniapp:back-ack' && ['handled', 'close', 'ignored'].includes(packet.action);

export function documentBack(scope, failure) {
  if (documents.has(scope)) return documents.get(scope);
  let bridge, documentId, origin, identity, detach, active, lastAck;
  let stopped = false, closing = false, lastId = 0;
  const handlers = [];
  const now = () => (scope.performance ?? globalThis.performance).now();
  const sameDocument = () => !stopped && scope.__LinkMiniAppHost === bridge &&
    bridge.documentId === documentId && scope.location?.origin === origin &&
    (!('top' in scope) || scope.top === scope);

  function stop() {
    if (stopped) return;
    stopped = true;
    if (active) { clearTimeout(active.timer); active.controller.abort(); }
    handlers.length = 0;
    try { detach?.(); } catch { /* The host is already being torn down. */ }
  }
  function send(ack) {
    if (!sameDocument()) { stop(); return; }
    try { Promise.resolve(bridge.ackBack(ack)).catch(stop); }
    catch { stop(); }
  }
  function acknowledge(eventId, action) {
    lastAck = Object.freeze({ version: 1, type: 'link-miniapp:back-ack',
      document_id: documentId, event_id: eventId, action });
    if (action === 'close') closing = true;
    send(lastAck);
  }
  function finish(operation, action) {
    if (operation.done) return;
    operation.done = true;
    clearTimeout(operation.timer);
    // Invalidate async work before acknowledging timeout or unsubscription.
    if (action === 'ignored') operation.controller.abort();
    acknowledge(operation.id, action);
  }
  function receive(packet) {
    if (!sameDocument()) { stop(); return; }
    if (!isBackEvent(packet, documentId)) return;
    const id = packet.event_id;
    if (id <= lastId) {
      if (lastAck?.event_id === id) send(lastAck);
      return;
    }
    lastId = id;
    // A host must coalesce taps while waiting. Also guard against a broken host
    // and an async handler still running after its deadline or unsubscription.
    if (active || closing) { acknowledge(id, 'ignored'); return; }
    const entry = handlers.at(-1);
    if (!entry) { acknowledge(id, 'close'); return; }
    const operation = { id, entry, controller: new AbortController(), done: false,
      deadline: now() + BACK_TIMEOUT_MS, timer: undefined };
    active = operation;
    operation.timer = setTimeout(() => finish(operation, 'ignored'), BACK_TIMEOUT_MS);
    const settle = action => {
      if (!sameDocument()) stop();
      if (active === operation) active = undefined;
      // A busy JS thread can run promise callbacks before an overdue timer.
      finish(operation, now() >= operation.deadline ? 'ignored' : action);
    };
    Promise.resolve().then(() => {
      if (!sameDocument() || operation.controller.signal.aborted) return;
      if (now() >= operation.deadline) { finish(operation, 'ignored'); return; }
      return entry.handler(Object.freeze({ signal: operation.controller.signal }));
    }).then(result => {
      settle(result === true ? 'handled' : result === false ? 'close' : 'ignored');
    }, () => settle('ignored'));
  }
  const state = {
    get closed() { return stopped; },
    stop,
    connect(next, context) {
      if (stopped) return;
      const nextIdentity = JSON.stringify([context.appId, context.user.sub, context.environment]);
      if (bridge) {
        if (!sameDocument() || next !== bridge || nextIdentity !== identity) stop();
        return;
      }
      if (!Array.isArray(next?.capabilities) || !next.capabilities.includes(BACK_CAPABILITY) ||
          !validDocumentId(next.documentId) || typeof next.subscribeBack !== 'function' ||
          typeof next.ackBack !== 'function') return;
      bridge = next; documentId = next.documentId; origin = scope.location?.origin; identity = nextIdentity;
      try {
        detach = bridge.subscribeBack(receive);
        if (typeof detach !== 'function') throw Error();
        if (stopped) detach();
      } catch { stop(); }
    },
    onBack(handler) {
      if (stopped || closing) throw failure('ACCESS_REVOKED');
      if (typeof handler !== 'function') throw failure('INVALID_BACK_HANDLER');
      if (!bridge) throw failure('BACK_NOT_SUPPORTED');
      if (!sameDocument()) { stop(); throw failure('ACCESS_REVOKED'); }
      const entry = { handler };
      handlers.push(entry);
      return () => {
        const index = handlers.indexOf(entry);
        if (index < 0) return;
        handlers.splice(index, 1);
        if (active?.entry === entry) finish(active, 'ignored');
      };
    },
  };
  documents.set(scope, state);
  scope.addEventListener?.('linkminiapp:closed', stop, { once: true });
  scope.addEventListener?.('pagehide', stop, { once: true });
  scope.addEventListener?.('pageshow', event => { if (event.persisted) stop(); });
  return state;
}
