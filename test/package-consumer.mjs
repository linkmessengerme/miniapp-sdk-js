// Runs outside this repository against the installed npm tarball.
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import LinkMiniApp, { createSDK, MiniAppError } from '@link-apps/miniapp';
import { installBrowserHost } from '@link-apps/miniapp/browser-host';

assert.equal(typeof LinkMiniApp.getUserInfo, 'function');
assert.equal(new MiniAppError('LINK_REQUIRED').code, 'LINK_REQUIRED');
assert.equal(installBrowserHost({ opener: null }, { hostOrigin: 'https://host.example' }), false);
const origin = 'https://mini.example';
const scope = { crypto: webcrypto, location: new URL(origin),
  __LinkMiniAppHost: { async request(packet) {
    return { version: 1, request_id: packet.request_id, result: packet.method === 'close' ? {} : {
      result: 'LAUNCH_RESULT_READY', launch_id: 'fixture-launch', ready: {
        app_id: 'fixture-app', sub: 'fixture-sub', environment: 'ENVIRONMENT_LIVE',
        expires_at: new Date(Date.now() + 60_000).toISOString(), scopes: ['profile'],
        access_token: `ma_${'x'.repeat(43)}`, web: { id_token: 'fixture.proof.signature', allowed_origins: [origin] },
      },
    } };
  } },
  async fetch(url, options) {
    assert.equal(url, 'https://api-sdk.linkmessenger.me/miniapps/v1/userinfo');
    assert.equal(options.headers.Authorization, `Bearer ma_${'x'.repeat(43)}`);
    const response = Response.json({ sub: 'fixture-sub', profile: { name: 'Package consumer' } });
    Object.defineProperty(response, 'url', { value: url });
    return response;
  },
};
const sdk = createSDK(scope);
assert.deepEqual(await sdk.getUserInfo(), { sub: 'fixture-sub', name: 'Package consumer' });
await sdk.close();
await assert.rejects(sdk.getUserInfo(), { code: 'ACCESS_REVOKED' });
console.log('Installed ESM exports and UserInfo flow passed.');
