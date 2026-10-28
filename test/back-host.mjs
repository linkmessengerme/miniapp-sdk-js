// Synthetic host reference for contract tests, not an Android/iOS implementation.
// It owns the event sequence, deadline, checkout priority and close decision.
export function backHost({ documentId, send, close, hasCheckout = () => false,
  dismissCheckout = () => {}, now = () => performance.now() }) {
  let sequence = 0, pending, closed = false;
  const events = [], acks = [];
  function settle(action) {
    if (!pending) return;
    const current = pending;
    pending = undefined; clearTimeout(current.timer);
    if (action === 'close') { closed = true; close(); }
    current.resolve(action);
  }
  return {
    events, acks,
    get closed() { return closed; },
    get waiting() { return pending !== undefined; },
    back() {
      if (closed) return Promise.resolve('ignored');
      if (pending && now() >= pending.deadline) settle('ignored');
      // All host UI transitions must be serialized with the pending Back.
      if (pending) return pending.promise;
      if (hasCheckout()) { dismissCheckout(); return Promise.resolve('dismissed'); }
      const packet = { version: 1, type: 'link-miniapp:back', document_id: documentId, event_id: ++sequence };
      let resolve;
      const promise = new Promise(yes => { resolve = yes; });
      pending = { packet, resolve, promise, deadline: now() + 1500, timer: setTimeout(() => settle('ignored'), 1500) };
      events.push(packet); send(packet);
      return promise;
    },
    retry() {
      if (pending && now() >= pending.deadline) settle('ignored');
      if (pending) send(pending.packet);
    },
    ack(packet) {
      acks.push(packet);
      if (pending && now() >= pending.deadline) { settle('ignored'); return; }
      if (closed || !pending || packet?.version !== 1 || packet.type !== 'link-miniapp:back-ack' ||
          packet.document_id !== documentId || packet.event_id !== pending.packet.event_id ||
          !['handled', 'close', 'ignored'].includes(packet.action)) return;
      settle(packet.action);
    },
    revoke() { closed = true; settle('ignored'); },
  };
}
