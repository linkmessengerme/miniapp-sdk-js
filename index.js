export class MiniAppError extends Error {
  constructor(code) { super(code); this.name = "MiniAppError"; this.code = code; }
}

function allowsLocalHTTP(location, environment) {
  if (environment !== "ENVIRONMENT_TEST" || location?.protocol !== "http:") return false;
  try {
    const url = new URL(location.origin);
    return url.protocol === "http:" && url.origin === location.origin &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  } catch { return false; }
}

const DEFAULT_API_BASE = "https://api-sdk.linkmessenger.me";
const MAX_USERINFO_BYTES = 64 * 1024;

function apiOrigin(value) {
  try {
    const url = new URL(value);
    if (typeof value !== "string" || /[\s\\]/.test(value) || url.username || url.password ||
        url.pathname !== "/" || url.search || url.hash ||
        !(url.protocol === "https:" || allowsLocalHTTP(url, "ENVIRONMENT_TEST"))) throw new Error();
    return url;
  } catch { throw new MiniAppError("INVALID_CONFIG"); }
}

async function readUserInfo(response) {
  if (response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json" ||
      Number(response.headers.get("content-length")) > MAX_USERINFO_BYTES || !response.body) {
    throw new MiniAppError("INVALID_API_RESPONSE");
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_USERINFO_BYTES) throw new MiniAppError("INVALID_API_RESPONSE");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new MiniAppError("INVALID_API_RESPONSE"); }
}

function userInfo(data, context) {
  const invalid = () => { throw new MiniAppError("INVALID_API_RESPONSE"); };
  if (!data || data.sub !== context.user.sub) invalid();
  const result = { sub: data.sub };
  if (context.scopes.includes("profile") && data.profile != null) {
    if (typeof data.profile !== "object" || Array.isArray(data.profile)) invalid();
    for (const [wire, field] of [["name", "name"], ["username", "username"], ["avatar_url", "avatarUrl"]]) {
      if (data.profile[wire] != null) {
        if (typeof data.profile[wire] !== "string") invalid();
        result[field] = data.profile[wire];
      }
    }
  }
  if (context.scopes.includes("phone") && data.phone_number != null) {
    if (typeof data.phone_number !== "string" || !/^\+[0-9]{7,15}$/.test(data.phone_number)) invalid();
    result.phoneNumber = data.phone_number;
    if (data.phone_number_verified != null) {
      if (typeof data.phone_number_verified !== "boolean") invalid();
      result.phoneNumberVerified = data.phone_number_verified;
    }
  }
  return Object.freeze(result);
}

// The host injects a promise-based adapter only into the authorized top-level
// document. The SDK never accepts tokens from URLs, storage or postMessage.
export function createSDK(scope = globalThis, { apiBaseUrl = DEFAULT_API_BASE } = {}) {
  const api = apiOrigin(apiBaseUrl);
  let pending, pendingUserInfo, current, generation = 0, closed = false;
  // The browser adapter can be revoked while an API response is in flight.
  // Invalidate that response even when the application has not called close().
  scope.addEventListener?.("linkminiapp:closed", () => {
    closed = true; generation++; current = undefined;
  }, { once: true });
  async function request(method) {
    if ("top" in scope && scope.top !== scope) throw new MiniAppError("NOT_MAIN_FRAME");
    const bridge = scope.__LinkMiniAppHost;
    if (!bridge || typeof bridge.request !== "function") throw new MiniAppError("LINK_REQUIRED");
    const requestId = scope.crypto.randomUUID();
    let timer;
    try {
      let response = await Promise.race([
        Promise.resolve().then(() => bridge.request({ version: 1, request_id: requestId, method })),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new MiniAppError("HOST_TIMEOUT")), 10000); })
      ]);
      if (typeof response === "string") {
        if (response.length > 65536) throw new MiniAppError("INVALID_HOST_RESPONSE");
        response = JSON.parse(response);
      }
      if (!response || response.version !== 1 || response.request_id !== requestId) throw new MiniAppError("INVALID_HOST_RESPONSE");
      if (response.error) throw new MiniAppError(response.error.code || "HOST_ERROR");
      return response.result;
    } finally { clearTimeout(timer); }
  }
  const sdk = Object.freeze({
    init() {
      if (closed) return Promise.reject(new MiniAppError("ACCESS_REVOKED"));
      if (pending) return pending;
      pending = (async () => {
        const launch = await request("init");
        if (closed) throw new MiniAppError("ACCESS_REVOKED");
        const ready = launch?.ready;
        const web = ready?.web;
        const expiresAt = Date.parse(ready?.expires_at);
        if (launch?.result !== "LAUNCH_RESULT_READY" || !launch.launch_id || !ready?.app_id || !ready.sub ||
            !web?.id_token || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new MiniAppError("AUTHORIZATION_REQUIRED");
        if (!(scope.location?.protocol === "https:" || allowsLocalHTTP(scope.location, ready.environment)) || !Array.isArray(web.allowed_origins) ||
            !web.allowed_origins.includes(scope.location.origin)) throw new MiniAppError("ORIGIN_NOT_ALLOWED");
        if (!["ENVIRONMENT_TEST", "ENVIRONMENT_LIVE"].includes(ready.environment) ||
            (ready.scopes != null && (!Array.isArray(ready.scopes) || !ready.scopes.every(s => typeof s === "string")))) {
          throw new MiniAppError("INVALID_HOST_RESPONSE");
        }
        const context = Object.freeze({
          idToken: web.id_token,
          accessToken: typeof ready.access_token === "string" ? ready.access_token : undefined,
          scopes: Object.freeze(Array.isArray(ready.scopes) ? [...ready.scopes] : ["profile"]),
          user: Object.freeze({ sub: ready.sub, name: ready.profile?.name || "", username: ready.profile?.username || "", avatarUrl: ready.profile?.avatar_url || "" }),
          appId: ready.app_id, launchId: launch.launch_id, environment: ready.environment, expiresAt
        });
        if (current && (current.launchId !== context.launchId || current.appId !== context.appId ||
            current.user.sub !== context.user.sub || current.environment !== context.environment ||
            current.scopes.join(" ") !== context.scopes.join(" "))) generation++;
        current = context;
        return context;
      })().catch(error => { generation++; current = undefined; throw error; })
        .finally(() => { pending = undefined; });
      return pending;
    },
    getUserInfo() {
      if (closed) return Promise.reject(new MiniAppError("ACCESS_REVOKED"));
      if (pendingUserInfo) return pendingUserInfo;
      pendingUserInfo = (async () => {
        // Ask the host for the current token each time; it may reissue it as a new launch.
        const context = await sdk.init();
        const ticket = generation, origin = scope.location.origin;
        if (!/^ma_[A-Za-z0-9_-]{43}$/.test(context.accessToken ?? "")) throw new MiniAppError("AUTHORIZATION_REQUIRED");
        if (api.protocol !== "https:" && !allowsLocalHTTP(api, context.environment)) throw new MiniAppError("INVALID_CONFIG");
        if (typeof scope.fetch !== "function") throw new MiniAppError("TRANSPORT");
        const endpoint = `${api.origin}/miniapps/v1/userinfo`;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);
        try {
          const response = await scope.fetch(endpoint, {
            method: "GET",
            headers: { Authorization: `Bearer ${context.accessToken}`, Accept: "application/json" },
            credentials: "omit", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer",
            signal: controller.signal,
          });
          if (response.redirected || response.url !== endpoint) throw new MiniAppError("INVALID_API_RESPONSE");
          if (response.status !== 200) {
            if (response.body) await response.body.cancel().catch(() => {});
            throw new MiniAppError(({ 401: "AUTHORIZATION_REQUIRED", 403: "ACCESS_REVOKED", 503: "SERVICE_UNAVAILABLE" })[response.status] || "HTTP_ERROR");
          }
          const info = userInfo(await readUserInfo(response), context);
          if (closed || ticket !== generation) throw new MiniAppError("ACCESS_REVOKED");
          if (scope.location.origin !== origin || ("top" in scope && scope.top !== scope)) throw new MiniAppError("ORIGIN_NOT_ALLOWED");
          if (context.expiresAt <= Date.now()) throw new MiniAppError("AUTHORIZATION_REQUIRED");
          return info;
        } catch (error) {
          if (error instanceof MiniAppError) throw error;
          throw new MiniAppError(controller.signal.aborted ? "API_TIMEOUT" : "TRANSPORT");
        } finally { clearTimeout(timer); controller.abort(); }
      })().finally(() => { pendingUserInfo = undefined; });
      return pendingUserInfo;
    },
    async close() { closed = true; generation++; current = undefined; await request("close"); }
  });
  return sdk;
}

export const LinkMiniApp = createSDK();
export default LinkMiniApp;
if (typeof window !== "undefined") Object.defineProperty(window, "LinkMiniApp", { value: LinkMiniApp, configurable: false });
