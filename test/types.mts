import LinkMiniApp, { createSDK, type MiniAppUserInfo, type BackContext, type BackHandler,
  type BackEventPacket, type BackAckPacket, type BackHostBridge, type MiniAppInsets, type MenuItem,
  type HeaderStatePacket, type HeaderEventPacket, type HeaderHostBridge, type HeaderLayout, type HeaderRect, type DeviceState, type PauseReason, type ClosingReason, type DeviceHostBridge } from "@link-apps/miniapp";
import { installHeaderPreview, type HeaderPreview } from "@link-apps/miniapp/preview";
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
  const insets: MiniAppInsets = LinkMiniApp.getInsets();
  const top: number = insets.headerHeight + insets.safeArea.bottom;
  const stop: () => void = LinkMiniApp.onInsetsChange(next => { void next.safeArea.left; });
  stop();
  // @ts-expect-error Insets are read-only.
  insets.headerHeight = 0;
  const preview: HeaderPreview | null = installHeaderPreview(window, { device: 'desktop', title: 'Shop' });
  preview?.update({ headerHeight: 60 });
  // @ts-expect-error Only phone and desktop are previewed.
  installHeaderPreview(window, { device: 'tablet' });
  void top;
  LinkMiniApp.setBackButton('hidden');
  LinkMiniApp.setCloseConfirmation(true);
  const items: MenuItem[] = [{ id: 'settings', title: 'Settings', icon: 'settings' }, { id: 'rules', title: 'Rules', icon: 'rules' }];
  LinkMiniApp.setMenuItems(items);
  const stopMenu: () => void = LinkMiniApp.onMenuItem((id: string) => { void id; });
  stopMenu();
  LinkMiniApp.onMinimize(() => {}); LinkMiniApp.onRestore(() => {});
  await LinkMiniApp.minimize();
  LinkMiniApp.setHeaderStyle({ icons: 'light' });
  LinkMiniApp.setHeaderStyle({ title: 'hidden' });
  LinkMiniApp.setHeaderStyle({ icons: 'dark', title: 'shown' });
  // @ts-expect-error At least one key.
  LinkMiniApp.setHeaderStyle({});
  // @ts-expect-error The page cannot set the title text.
  LinkMiniApp.setHeaderStyle({ title: 'My shop' });
  LinkMiniApp.setFullscreen(true);
  LinkMiniApp.setOrientation('landscape');
  LinkMiniApp.setSoundControl(true);
  LinkMiniApp.onSoundChange((muted: boolean) => { void muted; });
  const isMuted: boolean = LinkMiniApp.isMuted();
  LinkMiniApp.onPause((reason: PauseReason) => { void reason; });
  LinkMiniApp.onResume(() => {});
  LinkMiniApp.onClosing((reason: ClosingReason) => { void reason; });
  // @ts-expect-error Unknown pause reason.
  const badReason: PauseReason = 'nap';
  const supported: boolean = LinkMiniApp.supports('header_v1');
  const device: DeviceState | null = LinkMiniApp.getDevice();
  if (device && (device.thermal === 'serious' || device.powerSaving || device.performance === 'low')) void device.platform;
  LinkMiniApp.onDeviceChange(next => { void next.batteryLow; });
  const deviceBridge: DeviceHostBridge = { documentId: 'document', capabilities: ['device_v1'], subscribeDevice(listener) {
    listener({ version: 1, type: 'link-miniapp:device', document_id: 'document', event_id: 1, state: { platform: 'ios',
      link_version: '7.1.0', performance: 'high', thermal: 'nominal', power_saving: false, battery_low: false } }); return () => {}; } };
  void deviceBridge; void isMuted; void badReason; void supported;
  const corner: number = LinkMiniApp.getInsets().controls.width;
  const layout: HeaderLayout = LinkMiniApp.getHeaderLayout();
  const gap: HeaderRect | null = layout.free;
  if (gap) void (gap.x + gap.width);
  // @ts-expect-error Rectangles can be absent.
  void layout.back.x;
  const stopLayout: () => void = LinkMiniApp.onHeaderLayoutChange(next => { void next.controls; });
  stopLayout();
  void corner;
  // @ts-expect-error Unknown Back button mode.
  LinkMiniApp.setBackButton('none');
  // @ts-expect-error Only icons drawn by Link.
  LinkMiniApp.setMenuItems([{ id: 'x', title: 'X', icon: 'https://example.com/x.png' }]);
  // @ts-expect-error The header colour itself is not set by the page.
  LinkMiniApp.setHeaderStyle({ icons: 'dark', color: '#000000' });
  const state: HeaderStatePacket = { version: 1, type: 'link-miniapp:header-state', document_id: 'document', revision: 1,
    state: { back_button: 'auto', close_confirmation: false, menu_items: items, icons: 'auto', title: 'shown', fullscreen: false, orientation: 'auto', sound_control: false } };
  const pick: HeaderEventPacket = { version: 1, type: 'link-miniapp:header-event', document_id: 'document',
    event_id: 1, event: 'menu_item', item_id: 'settings' };
  // @ts-expect-error A menu event names its item.
  const broken: HeaderEventPacket = { version: 1, type: 'link-miniapp:header-event', document_id: 'document', event_id: 2, event: 'menu_item' };
  const headerBridge: HeaderHostBridge = { documentId: 'document', capabilities: ['back_v1', 'header_v1'],
    setHeaderState(packet) { void packet.revision; }, subscribeHeader(listener) { listener(pick); return () => {}; } };
  headerBridge.setHeaderState(state);
  void broken;
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
