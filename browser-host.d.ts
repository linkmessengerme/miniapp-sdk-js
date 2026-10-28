/** Explicitly opt in to a trusted web host; never read hostOrigin from a URL. */
export function installBrowserHost(scope: Window & typeof globalThis, options: { hostOrigin: string }): boolean;

/** Sent by the trusted opener together with exactly one MessagePort. */
export interface BrowserHostConnection {
  readonly type: 'link-miniapp:connected';
  readonly version: 1;
  /** Also the document_id for back_v1 events on the transferred port. */
  readonly nonce: string;
  /** Advertise back_v1/payments_v1 only with their complete host contracts. */
  readonly capabilities?: readonly string[];
}
