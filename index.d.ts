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
