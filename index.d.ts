export class MiniAppError extends Error {
  readonly code: string;
  constructor(code: string);
}

export interface MiniAppContext {
  readonly idToken: string;
  readonly accessToken?: string;
  readonly scopes: readonly string[];
  readonly user: Readonly<{ sub: string; name: string; username: string; avatarUrl: string }>;
  readonly appId: string;
  readonly launchId: string;
  readonly environment: "ENVIRONMENT_TEST" | "ENVIRONMENT_LIVE";
  /** Expiry as Unix time in milliseconds. */
  readonly expiresAt: number;
  /**
   * Value of `start` from the link that opened the app,
   * `https://linkm.me/miniapps/<slug>?start=<value>`: 1 to 256 Latin letters, digits
   * and `._-`. Absent for a launch without it and on hosts released before 0.3.0.
   * Untrusted: anyone can write a link. Use it as an identifier to look up, never
   * as a URL, an API origin or proof of anything. Apply it once per document.
   */
  readonly startParam?: string;
}

/** Fresh data. Optional fields can disappear after authorization is withdrawn. */
export interface MiniAppUserInfo {
  readonly sub: string;
  readonly name?: string;
  readonly username?: string;
  readonly avatarUrl?: string;
  readonly phoneNumber?: string;
  readonly phoneNumberVerified?: boolean;
}

export interface MiniAppSDK {
  init(): Promise<MiniAppContext>;
  /** Uses the current host session; does not request additional scopes or consent. */
  getUserInfo(): Promise<MiniAppUserInfo>;
  /** After init(). Latest subscription wins; false closes, true stays open.
   * Throws BACK_NOT_SUPPORTED on older hosts. Returns an idempotent unsubscribe. */
  onBack(handler: BackHandler): () => void;
  close(): Promise<void>;
  /** Space taken by the Link header and the system bars, in CSS pixels. Works
   * without init(); every value is 0 outside Link and on hosts without the
   * overlay header. */
  getInsets(): MiniAppInsets;
  /** Called with new values after rotation, a window resize or a header change.
   * Not called when nothing changed. Returns an idempotent unsubscribe. */
  onInsetsChange(listener: (insets: MiniAppInsets) => void): () => void;
  /** Where the Link header controls are, to place the page's own controls next
   * to them. Works without init(); on hosts without header_v1 every rectangle is
   * null. Touches on these rectangles always go to Link. */
  getHeaderLayout(): HeaderLayout;
  /** Called with new values after rotation, a window resize, fullscreen or a
   * change of the left button. Not called when nothing changed. Returns an
   * idempotent unsubscribe. */
  onHeaderLayoutChange(listener: (layout: HeaderLayout) => void): () => void;

  // header_v1. Every method below works after init() on a host that advertises
  // header_v1 and throws MiniAppError('HEADER_NOT_SUPPORTED') otherwise; the
  // header then keeps its usual behaviour. Settings last until the document
  // is replaced; a reload or navigation starts again from the defaults.

  /** Left header button. 'auto' (default): Back when the page has somewhere to go
   * back to, Close otherwise. 'hidden' hides the button; closing stays available
   * in the ⋯ menu. A Back tap is delivered through onBack(). */
  setBackButton(mode: BackButtonMode): void;
  /** When true, Link asks before the user closes the app with ✕, the menu, a
   * gesture or Back. Minimizing and LinkMiniApp.close() never ask. Default false. */
  setCloseConfirmation(enabled: boolean): void;
  /** Up to 5 own items, shown before the Link items of the ⋯ menu, which always
   * remain. Replaces the previous list; [] removes them. Throws INVALID_MENU_ITEMS. */
  setMenuItems(items: readonly MenuItem[]): void;
  /** Called with the item ID when the user picks an own menu item. Every listener
   * is called. Returns an idempotent unsubscribe. */
  onMenuItem(listener: (id: string) => void): () => void;
  /** Called after the user or minimize() has minimized the app. The page keeps
   * running: pause a game and mute sound here. Returns an idempotent unsubscribe. */
  onMinimize(listener: () => void): () => void;
  /** Called when the minimized app is opened again. Returns an idempotent unsubscribe. */
  onRestore(listener: () => void): () => void;
  /** Minimizes the app as the ⌄ button does. */
  minimize(): Promise<void>;
  /** icons: colour of the header buttons and the status bar drawn over the page,
   * 'light' for a dark page, 'dark' for a light page; default 'auto'.
   * title: 'hidden' removes the capsule with the app icon and name, freeing the
   * header row; Link then shows the name at the top of the ⋯ menu. Default 'shown'.
   * Only the keys given change. */
  setHeaderStyle(style: HeaderStyle): void;
  /** For games: the header shrinks to a small ⋯ | ⌄ capsule in the top right
   * corner. The title and the left button are hidden; closing stays in the
   * menu. headerHeight from getInsets() changes with it. Default false. */
  setFullscreen(enabled: boolean): void;
  /** 'landscape' or 'portrait' turns the Mini App screen and keeps it so while
   * it is open; Link returns to its own orientation on minimize and close.
   * 'auto' (default) follows the device. No effect on desktop. */
  setOrientation(orientation: 'auto' | 'portrait' | 'landscape'): void;
  /** true adds a Link «Без звука» / «Включить звук» item to the ⋯ menu. Link
   * remembers the choice per app and reports it with onSoundChange(); the page
   * mutes itself, Link cannot mute a page. Default false. */
  setSoundControl(enabled: boolean): void;
  /** Called with true when the user mutes the app in the ⋯ menu, false when sound
   * returns, and once after setSoundControl(true) if the remembered choice is muted. */
  onSoundChange(listener: (muted: boolean) => void): () => void;
  /** Current choice; false outside Link, on older hosts and without setSoundControl(true). */
  isMuted(): boolean;
  /** Called when the page stops being in front: minimized, Link in the background,
   * screen locked, an interruption such as a call, or a Link overlay over the page
   * (⋯ menu, dialog, sheet). Pause a game here. Not repeated while paused. */
  onPause(listener: (reason: PauseReason) => void): () => void;
  /** Called when nothing covers the page any more. */
  onResume(listener: () => void): () => void;
  isPaused(): boolean;
  /** Called just before the app closes; the page has about 300 ms to save, so use
   * synchronous storage or navigator.sendBeacon. Not called for LinkMiniApp.close(). */
  onClosing(listener: (reason: ClosingReason) => void): () => void;

  /** Whether a host extension is available: false before init() and on hosts that
   * do not provide all of it. 'back_v1', 'header_v1', 'device_v1', … */
  supports(capability: string): boolean;
  /** Coarse device state from device_v1; null before init(), on older hosts and
   * until the host has sent it. */
  getDevice(): DeviceState | null;
  /** Called when the device state changes. Throws DEVICE_NOT_SUPPORTED without
   * device_v1. Returns an idempotent unsubscribe. */
  onDeviceChange(listener: (state: DeviceState) => void): () => void;
}

export type PauseReason = 'minimized' | 'background' | 'locked' | 'interrupted' | 'overlay';
export type ClosingReason = 'user' | 'evicted' | 'revoked';
/** Deliberately coarse: no battery percentage, model or other identifying detail. */
export interface DeviceState {
  readonly platform: 'ios' | 'android' | 'desktop';
  readonly linkVersion: string;
  /** Link's estimate from memory and processor: lower effects on 'low'. */
  readonly performance: 'low' | 'mid' | 'high';
  /** From the system: reduce frame rate and quality from 'serious'. */
  readonly thermal: 'nominal' | 'fair' | 'serious' | 'critical';
  /** Low Power Mode / Battery Saver is on. */
  readonly powerSaving: boolean;
  /** The battery is low and not charging. */
  readonly batteryLow: boolean;
}
export interface DeviceEventPacket {
  readonly version: 1;
  readonly type: 'link-miniapp:device';
  readonly document_id: string;
  /** Strictly increasing positive safe integer per document. */
  readonly event_id: number;
  readonly state: Readonly<{ platform: DeviceState['platform']; link_version: string; performance: DeviceState['performance'];
    thermal: DeviceState['thermal']; power_saving: boolean; battery_low: boolean }>;
}
/** Optional device_v1 extension on the trusted, document-bound host adapter. */
export interface DeviceHostBridge {
  readonly capabilities: readonly string[];
  readonly documentId: string;
  subscribeDevice(listener: (packet: DeviceEventPacket) => void): () => void;
}

export type BackButtonMode = 'auto' | 'back' | 'close' | 'hidden';
export type MenuIcon = 'settings' | 'info' | 'help' | 'star' | 'bookmark' | 'edit' | 'search' |
  'bell' | 'user' | 'gift' | 'cart' | 'list' | 'chat' | 'sound' | 'mute' | 'pause' | 'play' | 'restart' | 'rules';
export interface MenuItem {
  /** 1 to 32 characters: a-z, 0-9, '_' and '-'. Unique within the list. */
  readonly id: string;
  /** Plain text, 1 to 32 characters after trimming, one line. */
  readonly title: string;
  /** One of the icons drawn by Link; no images or URLs. */
  readonly icon?: MenuIcon;
}
export type HeaderStyle = Readonly<{ icons?: 'auto' | 'light' | 'dark'; title?: 'shown' | 'hidden' }> &
  ({ readonly icons: 'auto' | 'light' | 'dark' } | { readonly title: 'shown' | 'hidden' });

/** The whole header state; the host applies the highest revision it has seen. */
export interface HeaderStatePacket {
  readonly version: 1;
  readonly type: 'link-miniapp:header-state';
  readonly document_id: string;
  /** Strictly increasing positive safe integer per document, chosen by the SDK. */
  readonly revision: number;
  readonly state: Readonly<{
    back_button: BackButtonMode;
    close_confirmation: boolean;
    menu_items: readonly MenuItem[];
    icons: 'auto' | 'light' | 'dark';
    title: 'shown' | 'hidden';
    fullscreen: boolean;
    orientation: 'auto' | 'portrait' | 'landscape';
    sound_control: boolean;
  }>;
}
/** Host event IDs are strictly increasing positive safe integers per document. */
export type HeaderEventPacket = Readonly<{
  version: 1;
  type: 'link-miniapp:header-event';
  document_id: string;
  event_id: number;
}> & (Readonly<{ event: 'menu_item'; item_id: string }> | Readonly<{ event: 'minimize' | 'restore' | 'resume' }> |
  Readonly<{ event: 'pause'; reason: PauseReason }> | Readonly<{ event: 'closing'; reason: ClosingReason }> |
  Readonly<{ event: 'sound'; muted: boolean }>);
/** Optional header_v1 extension on the trusted, document-bound host adapter.
 * The adapter also handles request method 'minimize'. */
export interface HeaderHostBridge {
  readonly capabilities: readonly string[];
  readonly documentId: string;
  setHeaderState(packet: HeaderStatePacket): void;
  subscribeHeader(listener: (packet: HeaderEventPacket) => void): () => void;
}

/** Distances from the edges of the WebView. headerHeight already includes
 * safeArea.top; the values are not added together. */
export interface MiniAppInsets {
  readonly headerHeight: number;
  readonly safeArea: Readonly<{ top: number; right: number; bottom: number; left: number }>;
  /** The ⋯ capsule of the Link header: top and right are distances from the top
   * and right edges of the WebView. All 0 on hosts without header_v1. In
   * fullscreen, keep only this rectangle clear and use the rest of the top row. */
  readonly controls: Readonly<{ top: number; right: number; width: number; height: number }>;
}

/** CSS pixels from the top left corner of the page. */
export interface HeaderRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}
export interface HeaderLayout {
  /** Same as getInsets().headerHeight. */
  readonly height: number;
  /** The ✕ / ‹ button; null when hidden, in fullscreen or on older hosts. */
  readonly back: HeaderRect | null;
  /** The capsule with the app icon and name; null when hidden, in fullscreen or on older hosts. */
  readonly title: HeaderRect | null;
  /** The ⋯ | ⌄ capsule; null only on older hosts. */
  readonly controls: HeaderRect | null;
  /** The gap in the header row between the left elements and the capsule, with
   * 8 px margins; null when narrower than 48 px. The page may put its own
   * controls here. */
  readonly free: HeaderRect | null;
}

export interface BackContext {
  /** Aborted on the 1-second deadline, unsubscribe, close, or document teardown.
   * Check before changing UI after an await; cancellation cannot undo app effects. */
  readonly signal: AbortSignal;
}
export type BackHandler = (context: BackContext) => boolean | Promise<boolean>;

/** Host event IDs are strictly increasing positive safe integers per document. */
export interface BackEventPacket {
  readonly version: 1;
  readonly type: 'link-miniapp:back';
  readonly document_id: string;
  readonly event_id: number;
}
export interface BackAckPacket {
  readonly version: 1;
  readonly type: 'link-miniapp:back-ack';
  readonly document_id: string;
  readonly event_id: number;
  /** ignored (including errors/timeouts) keeps the Mini App open. */
  readonly action: 'handled' | 'close' | 'ignored';
}
/** Optional back_v1 extension on the trusted, document-bound host adapter. */
export interface BackHostBridge {
  readonly capabilities: readonly string[];
  readonly documentId: string;
  subscribeBack(listener: (packet: BackEventPacket) => void): () => void;
  ackBack(packet: BackAckPacket): void;
}

export interface MiniAppOptions {
  /** Trusted API origin set by the integrator, never from URL/launch parameters. */
  apiBaseUrl?: string;
}

/** scope is normally window/globalThis; a custom surface is useful for host tests. */
export function createSDK(scope?: typeof globalThis | object, options?: MiniAppOptions): MiniAppSDK;
export const LinkMiniApp: MiniAppSDK;
export default LinkMiniApp;

declare global {
  interface Window { readonly LinkMiniApp: MiniAppSDK; }
}
