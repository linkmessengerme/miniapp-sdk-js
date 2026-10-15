import { test } from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { createSDK } from "../index.js";
import { hostHarness } from "./host-harness.mjs";

const endpoint = "https://api-sdk.linkmessenger.me/miniapps/v1/userinfo";
const token = `ma_${"a".repeat(43)}`;
const data = { sub: "pairwise", profile: { name: "Fresh Name", username: "alice", avatar_url: "https://images.example/a.jpg" }, phone_number: "+12025550123" };
function response(body = data, status = 200, url = endpoint, headers = { "Content-Type": "application/json" }) {
  const result = new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers });
  Object.defineProperty(result, "url", { value: url });
  return result;
}
function fixture(options) {
  const origin = "https://mini.example.com";
  const launch = { result: "LAUNCH_RESULT_READY", launch_id: "launch", ready: {
    app_id: "app", sub: "pairwise", environment: "ENVIRONMENT_TEST", expires_at: new Date(Date.now() + 60000).toISOString(),
    access_token: token, scopes: ["profile", "phone"], web: { id_token: "signed-id-proof", allowed_origins: [origin] },
  } };
  const host = hostHarness(launch, origin), requests = [];
  const scope = { crypto: webcrypto, location: new URL(origin), __LinkMiniAppHost: host,
    fetch: async (...args) => { requests.push(args); return response(); } };
  scope.top = scope;
  return { launch, host, scope, requests, sdk: createSDK(scope, options) };
}

test("getUserInfo initializes itself, uses only the bearer, returns fresh typed data and shares concurrent requests", async () => {
  const f = fixture();
  const [a, b] = await Promise.all([f.sdk.getUserInfo(), f.sdk.getUserInfo()]);
  assert.equal(a, b); assert.ok(Object.isFrozen(a));
  assert.deepEqual(a, { sub: "pairwise", name: "Fresh Name", username: "alice", avatarUrl: data.profile.avatar_url, phoneNumber: "+12025550123" });
  assert.equal(a.phoneNumberVerified, undefined);
  assert.equal(f.requests.length, 1);
  const [url, options] = f.requests[0];
  assert.equal(url, endpoint);
  assert.equal(options.headers.Authorization, `Bearer ${token}`);
  assert.equal(options.headers.Accept, "application/json");
  assert.equal(options.credentials, "omit"); assert.equal(options.cache, "no-store");
  assert.equal(options.redirect, "error"); assert.equal(options.referrerPolicy, "no-referrer");
  assert.equal(options.method, "GET"); assert.equal(options.body, undefined);
  f.scope.fetch = async () => response({ sub: "pairwise" });
  assert.deepEqual(await f.sdk.getUserInfo(), { sub: "pairwise" });
});

test("reissued host tokens are used and ungranted fields are never exposed", async () => {
  const f = fixture(); await f.sdk.getUserInfo();
  f.launch.ready.access_token = `ma_${"b".repeat(43)}`;
  f.launch.ready.scopes = ["profile"]; f.host.replace(f.launch);
  assert.equal((await f.sdk.getUserInfo()).phoneNumber, undefined);
  assert.equal(f.requests[1][1].headers.Authorization, `Bearer ${f.launch.ready.access_token}`);
  f.launch.ready.scopes = []; f.host.replace(f.launch);
  assert.deepEqual(await f.sdk.getUserInfo(), { sub: "pairwise" });
  delete f.launch.ready.access_token; f.host.replace(f.launch);
  await assert.rejects(f.sdk.getUserInfo(), /AUTHORIZATION_REQUIRED/);
  assert.equal(f.requests.length, 3);
});

test("a token reissued as a new launch of the same app is used for the next request", async () => {
  const f = fixture(); await f.sdk.getUserInfo();
  f.launch.launch_id = "relaunch"; f.launch.ready.access_token = `ma_${"c".repeat(43)}`; f.host.replace(f.launch);
  assert.deepEqual((await f.sdk.getUserInfo()).sub, "pairwise");
  assert.equal(f.requests[1][1].headers.Authorization, `Bearer ${f.launch.ready.access_token}`);
  assert.equal((await f.sdk.init()).launchId, "relaunch");
});

test("regional API is explicitly configured; unsafe API origins fail before sending a token", async () => {
  const f = fixture({ apiBaseUrl: "https://api-sdk-fr.linkmessenger.me" });
  f.scope.fetch = async url => { assert.equal(url, "https://api-sdk-fr.linkmessenger.me/miniapps/v1/userinfo"); return response(data, 200, url); };
  assert.equal((await f.sdk.getUserInfo()).phoneNumber, "+12025550123");
  for (const apiBaseUrl of ["http://remote.example", "https://user:pass@api.example", "https://api.example/path", "https://api.example?token=x", "https://api.example#x", "javascript:alert(1)", "//api.example"]) {
    assert.throws(() => fixture({ apiBaseUrl }), /INVALID_CONFIG/);
  }
  const local = fixture({ apiBaseUrl: "http://127.0.0.1:3001" });
  local.scope.fetch = async url => response(data, 200, url);
  assert.equal((await local.sdk.getUserInfo()).sub, "pairwise");
  local.launch.ready.environment = "ENVIRONMENT_LIVE"; local.host.replace(local.launch);
  await assert.rejects(local.sdk.getUserInfo(), /INVALID_CONFIG/);
});

test("bad subjects, malformed claims, redirects, content types and oversized/chunked bodies are rejected", async () => {
  const f = fixture();
  for (const make of [
    () => response({ ...data, sub: "other" }), () => response({ profile: data.profile }),
    () => response({ ...data, phone_number: 123 }), () => response({ ...data, phone_number: "bad" }),
    () => response({ ...data, phone_number_verified: "true" }), () => response({ ...data, profile: { name: 7 } }),
    () => response("not-json"), () => response(data, 200, "https://attacker.example"),
    () => response(data, 200, endpoint, { "Content-Type": "text/html" }),
    () => response(data, 200, endpoint, { "Content-Type": "application/json", "Content-Length": "999999" }),
    () => response("x".repeat(65537)),
  ]) {
    f.scope.fetch = async () => make();
    await assert.rejects(f.sdk.getUserInfo(), /INVALID_API_RESPONSE/);
  }
  f.scope.fetch = async () => response({ ...data, phone_number_verified: false });
  assert.equal((await f.sdk.getUserInfo()).phoneNumberVerified, false);
});

test("revocation, expiry and outages are sanitized and never silently return the init profile", async () => {
  const f = fixture();
  for (const [status, code] of [[401, "AUTHORIZATION_REQUIRED"], [403, "ACCESS_REVOKED"], [503, "SERVICE_UNAVAILABLE"], [500, "HTTP_ERROR"]]) {
    f.scope.fetch = async () => response({ error: "DO-NOT-LEAK-TOKEN" }, status);
    await assert.rejects(f.sdk.getUserInfo(), error => error.code === code && !error.message.includes("LEAK"));
  }
  f.scope.fetch = async () => { throw new Error("DO-NOT-LEAK-TOKEN"); };
  await assert.rejects(f.sdk.getUserInfo(), { message: "TRANSPORT" });
  f.launch.ready.expires_at = new Date(0).toISOString(); f.host.replace(f.launch);
  await assert.rejects(f.sdk.getUserInfo(), /ACCESS_REVOKED/);
});

test("responses cannot outlive local close or a host session/scope change", async () => {
  for (const change of ["close", "subject", "scopes", "origin", "denied"]) {
    const f = fixture(); let release, started;
    const ready = new Promise(resolve => { started = resolve; });
    f.scope.fetch = () => new Promise(resolve => { release = () => resolve(response()); started(); });
    const pending = f.sdk.getUserInfo();
    await ready;
    if (change === "close") await f.sdk.close();
    else if (change === "origin") f.scope.location = new URL("https://other.example");
    else if (change === "denied") {
      f.host.replace({ result: "LAUNCH_RESULT_DENIED" });
      await assert.rejects(f.sdk.init(), /ACCESS_REVOKED/);
    }
    else {
      if (change === "subject") f.launch.ready.sub = "other";
      else f.launch.ready.scopes = ["profile"];
      f.host.replace(f.launch); await f.sdk.init();
    }
    release();
    await assert.rejects(pending, new RegExp(change === "origin" ? "ORIGIN_NOT_ALLOWED" : "ACCESS_REVOKED"));
  }
});
