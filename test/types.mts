import LinkMiniApp, { createSDK, type MiniAppUserInfo, type BackContext, type BackHandler,
  type BackEventPacket, type BackAckPacket, type BackHostBridge } from "@link-apps/miniapp";
import { installBrowserHost, type BrowserHostConnection } from "@link-apps/miniapp/browser-host";

async function consume() {
  const installed: boolean = installBrowserHost(window, { hostOrigin: "http://localhost:3008" });
  const info: MiniAppUserInfo = await LinkMiniApp.getUserInfo();
  const phone: string | undefined = info.phoneNumber;
  const verified: boolean | undefined = info.phoneNumberVerified;
  const customAPI = createSDK(window, { apiBaseUrl: "https://api.example.com" });
  await customAPI.getUserInfo();
  const handler: BackHandler = async ({ signal }: BackContext) => !signal.aborted;
  const unsubscribe: () => void = customAPI.onBack(handler);
  window.LinkMiniApp.onBack(() => false);
  unsubscribe();
  // @ts-expect-error A Back handler must explicitly return a boolean.
  customAPI.onBack(() => {});
  // @ts-expect-error An async Back handler must also return a boolean.
  customAPI.onBack(async () => 'handled');
  const back: BackEventPacket = { version: 1, type: 'link-miniapp:back', document_id: 'document', event_id: 1 };
  const ack: BackAckPacket = { ...back, type: 'link-miniapp:back-ack', action: 'handled' };
  const bridge: BackHostBridge = { documentId: back.document_id, capabilities: ['back_v1'],
    subscribeBack(listener) { listener(back); return () => {}; }, ackBack(packet) { void packet; } };
  bridge.ackBack(ack);
  await window.LinkMiniApp.getUserInfo();
  // @ts-expect-error Scopes belong to consent/configuration, not UserInfo.
  await LinkMiniApp.getUserInfo({ scopes: ["phone"] });
  // @ts-expect-error Returned data is immutable.
  info.phoneNumber = "+12025550123";
  // @ts-expect-error A trusted host origin is required.
  installBrowserHost(window, {});
  const connection: BrowserHostConnection = { type: 'link-miniapp:connected', version: 1,
    nonce: 'nonce', capabilities: ['payments_v1', 'back_v1'] };
  // @ts-expect-error The public SDK does not expose private payment methods.
  await LinkMiniApp.pay({ paymentSessionId: 'session' });
  return { phone, verified, installed, connection };
}
void consume;
