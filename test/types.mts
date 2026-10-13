import LinkMiniApp, { createSDK, type MiniAppUserInfo } from "@link-apps/miniapp";
import { installBrowserHost } from "@link-apps/miniapp/browser-host";

async function consume() {
  const installed: boolean = installBrowserHost(window, { hostOrigin: "http://localhost:3008" });
  const info: MiniAppUserInfo = await LinkMiniApp.getUserInfo();
  const phone: string | undefined = info.phoneNumber;
  const verified: boolean | undefined = info.phoneNumberVerified;
  const regional = createSDK(window, { apiBaseUrl: "https://api-sdk-fr.linkmessenger.me" });
  await regional.getUserInfo();
  await window.LinkMiniApp.getUserInfo();
  // @ts-expect-error Scopes belong to consent/configuration, not UserInfo.
  await LinkMiniApp.getUserInfo({ scopes: ["phone"] });
  // @ts-expect-error Returned data is immutable.
  info.phoneNumber = "+12025550123";
  // @ts-expect-error A trusted host origin is required.
  installBrowserHost(window, {});
  return { phone, verified, installed };
}
void consume;
