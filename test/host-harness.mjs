// Test adapter, never imported by the production SDK. A real host performs
// create/consent/authorize before loading the document and renews every 30s.
export function hostHarness(launch, origin = "https://mini.example.com") {
  let current = structuredClone(launch);
  let closed = false;
  return {
    replace(next) { current = structuredClone(next); },
    isClosed() { return closed; },
    async request(packet) {
      const response = { version: 1, request_id: packet.request_id };
      if (packet.method === "close") { closed = true; return { ...response, result: {} }; }
      if (closed || packet.method !== "init" || current.result !== "LAUNCH_RESULT_READY" ||
          !current.ready?.web?.allowed_origins.includes(origin) || Date.parse(current.ready.expires_at) <= Date.now()) {
        return { ...response, error: { code: "ACCESS_REVOKED" } };
      }
      return { ...response, result: structuredClone(current) };
    }
  };
}
