/** Explicitly opt in to a trusted web host; never read hostOrigin from a URL. */
export function installBrowserHost(scope: Window & typeof globalThis, options: { hostOrigin: string }): boolean;
