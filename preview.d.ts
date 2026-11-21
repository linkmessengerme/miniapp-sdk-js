export interface HeaderPreviewOptions {
  /** Default "phone": status bar 54, header 98, home indicator 34. "desktop": header 52. */
  device?: 'phone' | 'desktop';
  title?: string;
  /** CSS pixels from the top edge, status bar included. */
  headerHeight?: number;
  safeArea?: Partial<Readonly<{ top: number; right: number; bottom: number; left: number }>>;
}

export interface HeaderPreview {
  /** Changes the values and announces them like a host does. */
  update(options?: HeaderPreviewOptions): void;
  remove(): void;
}

/** Development only: draws a stand-in for the Link header in an ordinary browser
 * and defines the host's CSS variables. Returns null inside Link. */
export function installHeaderPreview(scope?: typeof globalThis | object, options?: HeaderPreviewOptions): HeaderPreview | null;
