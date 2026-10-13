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
  close(): Promise<void>;
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
