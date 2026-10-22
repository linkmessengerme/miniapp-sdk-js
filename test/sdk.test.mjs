import { test } from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { createSDK, MiniAppError } from "../index.js";
import { hostHarness } from "./host-harness.mjs";

function fixture(origin = "https://mini.example.com", environment = "ENVIRONMENT_TEST") {
  const launch = { result: "LAUNCH_RESULT_READY", launch_id: "launch", ready: {
    app_id: "app", sub: "pairwise", environment, expires_at: new Date(Date.now() + 60000).toISOString(),
    profile: { name: "Alice" }, web: { id_token: "signed-proof", allowed_origins: [origin] }
  } };
  const host = hostHarness(launch, origin);
  const scope = { crypto: webcrypto, location: new URL(origin), __LinkMiniAppHost: host };
  scope.top = scope;
  return { launch, host, scope, sdk: createSDK(scope) };
}
test("init obtains the prepared proof without an argument; profile fields may be absent", async () => {
  const f = fixture(); const [a, b] = await Promise.all([f.sdk.init(), f.sdk.init()]);
  assert.equal(a, b); assert.equal(a.idToken, "signed-proof"); assert.equal(a.user.username, ""); assert.ok(Object.isFrozen(a.user));
  await f.sdk.close(); assert.equal(f.host.isClosed(), true); await assert.rejects(f.sdk.init(), /ACCESS_REVOKED/);
});
test("no bridge, denied consent, expiry, foreign origin and subframes fail closed", async () => {
  const f = fixture(); delete f.scope.__LinkMiniAppHost; await assert.rejects(f.sdk.init(), /LINK_REQUIRED/);
  f.scope.__LinkMiniAppHost = f.host;
  f.host.replace({ result: "LAUNCH_RESULT_DENIED" }); await assert.rejects(f.sdk.init(), /ACCESS_REVOKED/);
  f.launch.ready.expires_at = new Date(0).toISOString(); f.host.replace(f.launch); await assert.rejects(f.sdk.init(), /ACCESS_REVOKED/);
  f.launch.ready.expires_at = new Date(Date.now() + 60000).toISOString(); f.host.replace(f.launch);
  f.scope.location = new URL("https://attacker.example"); await assert.rejects(f.sdk.init(), /ORIGIN_NOT_ALLOWED/);
  f.scope.top = {}; await assert.rejects(f.sdk.init(), /NOT_MAIN_FRAME/);
});
test("unbound bridge replies are rejected", async () => {
  const f = fixture(); f.scope.__LinkMiniAppHost = { request: async () => ({ version: 1, request_id: "wrong", result: f.launch }) };
  await assert.rejects(f.sdk.init(), /INVALID_HOST_RESPONSE/);
});

test("malformed JSON and host failures expose only typed, sanitized errors", async () => {
  const marker = "synthetic-private-host-details";
  for (const [request, code] of [
    [() => `{${marker}`, "INVALID_HOST_RESPONSE"],
    [() => { throw new Error(marker); }, "HOST_ERROR"],
    [() => Promise.reject(new Error(marker)), "HOST_ERROR"],
    [() => Promise.reject({ code: { detail: marker } }), "HOST_ERROR"],
  ]) {
    const f = fixture(); f.scope.__LinkMiniAppHost = { request };
    await assert.rejects(f.sdk.init(), error => {
      assert.ok(error instanceof MiniAppError);
      assert.equal(error.code, code);
      assert.equal(error.message, code);
      assert.equal(error.cause, undefined);
      assert.ok(!String(error.stack).includes(marker));
      return true;
    });
  }
});

test("known adapter rejections retain their codes for init and close", async () => {
  for (const code of ["ACCESS_REVOKED", "HOST_TIMEOUT", "ORIGIN_NOT_ALLOWED"]) {
    for (const failure of [new Error(code), { code }]) {
      const f = fixture(); f.scope.__LinkMiniAppHost = { request: () => Promise.reject(failure) };
      for (const method of ["init", "close"]) {
        await assert.rejects(f.sdk[method](), error => error instanceof MiniAppError && error.code === code);
      }
    }
  }
});

test("host error packets require a valid code and cannot also contain a result", async () => {
  for (const error of [true, [], {}, { code: 7 }, { code: {} }, { code: "" },
    { code: "private host details" }, { code: "X".repeat(65) }]) {
    const f = fixture();
    f.scope.__LinkMiniAppHost = { request: packet => ({ version: 1, request_id: packet.request_id, error }) };
    await assert.rejects(f.sdk.init(), { name: "MiniAppError", code: "INVALID_HOST_RESPONSE" });
  }
  const f = fixture();
  f.scope.__LinkMiniAppHost = { request: packet => ({ version: 1, request_id: packet.request_id,
    error: { code: "ACCESS_REVOKED" }, result: f.launch }) };
  await assert.rejects(f.sdk.init(), { code: "INVALID_HOST_RESPONSE" });
});

test("valid JSON-string responses and future host error codes remain supported", async () => {
  const f = fixture();
  f.scope.__LinkMiniAppHost = { request: async packet => JSON.stringify(await f.host.request(packet)) };
  assert.equal((await f.sdk.init()).user.sub, "pairwise");
  f.scope.__LinkMiniAppHost = { request: packet => ({ version: 1, request_id: packet.request_id,
    error: { code: "HOST_MAINTENANCE" } }) };
  await assert.rejects(f.sdk.init(), { code: "HOST_MAINTENANCE" });
});

test("malformed launch fields never enter the public typed context", async () => {
  const changes = [
    launch => { launch.launch_id = {}; },
    launch => { launch.ready = []; },
    launch => { launch.ready.app_id = {}; },
    launch => { launch.ready.sub = 123; },
    launch => { launch.ready.sub = ""; },
    launch => { launch.ready.expires_at = Date.now() + 60000; },
    launch => { launch.ready.web = []; },
    launch => { launch.ready.web.id_token = {}; },
    launch => { launch.ready.web.allowed_origins.push(123); },
    launch => { launch.ready.access_token = {}; },
    launch => { launch.ready.scopes = ["profile", {}]; },
    launch => { launch.ready.profile = []; },
    launch => { launch.ready.profile = "Alice"; },
    ...["name", "username", "avatar_url"].map(field => launch => { launch.ready.profile[field] = {}; }),
  ];
  for (const change of changes) {
    const f = fixture(); change(f.launch);
    f.scope.__LinkMiniAppHost = { request: packet => ({ version: 1, request_id: packet.request_id, result: f.launch }) };
    await assert.rejects(f.sdk.init(), { name: "MiniAppError", code: "INVALID_HOST_RESPONSE" });
    let fetched = false;
    f.scope.fetch = () => { fetched = true; };
    await assert.rejects(f.sdk.getUserInfo(), { code: "INVALID_HOST_RESPONSE" });
    assert.equal(fetched, false);
  }
});

test("Test allows local HTTP only when the exact origin is allowed", async () => {
  for (const origin of ["http://localhost:3008", "http://127.0.0.1:3008", "http://[::1]:3008", "http://localhost"]) {
    const f = fixture(origin);
    assert.equal((await f.sdk.init()).environment, "ENVIRONMENT_TEST");
    f.scope.location.port = "3009";
    await assert.rejects(f.sdk.init(), /ORIGIN_NOT_ALLOWED/);
  }
});

test("Live and unknown environments reject local HTTP; Test rejects remote HTTP", async () => {
  for (const origin of ["http://localhost:3008", "http://127.0.0.1:3008", "http://[::1]:3008"]) {
    for (const environment of ["ENVIRONMENT_LIVE", "ENVIRONMENT_UNSPECIFIED", "test", ""]) {
      await assert.rejects(fixture(origin, environment).sdk.init(), /ORIGIN_NOT_ALLOWED/);
    }
  }
  for (const origin of ["http://example.com", "http://192.168.1.2:3008", "http://localhost.example", "http://127.0.0.1.example", "http://[::ffff:7f00:1]:3008"]) {
    await assert.rejects(fixture(origin).sdk.init(), /ORIGIN_NOT_ALLOWED/);
  }
  assert.equal((await fixture("https://mini.example.com", "ENVIRONMENT_LIVE").sdk.init()).environment, "ENVIRONMENT_LIVE");
});

test("init exposes only the separate scoped access token and preserves optional phone denial", async () => {
  const f = fixture();
  f.launch.ready.access_token = "ma_separate-access";
  f.launch.ready.scopes = ["profile", "phone"];
  f.host.replace(f.launch);
  const context = await f.sdk.init();
  assert.equal(context.accessToken, "ma_separate-access");
  assert.deepEqual(context.scopes, ["profile", "phone"]);
  assert.ok(Object.isFrozen(context.scopes));
  assert.equal(context.user.phone, undefined);
  delete f.launch.ready.access_token;
  f.launch.ready.scopes = ["profile"];
  f.host.replace(f.launch);
  assert.equal((await f.sdk.init()).accessToken, undefined);
});
