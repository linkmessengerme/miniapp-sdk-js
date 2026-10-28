import LinkMiniApp from '@link-apps/miniapp';

// Supply your application's modal/router APIs. Use app route state for root.
export async function registerBack(
  modal: { isOpen(): boolean; close(): void },
  router: { canGoBack(): boolean; back(): void },
): Promise<() => void> {
  await LinkMiniApp.init();
  return LinkMiniApp.onBack(() => {
    if (modal.isOpen()) { modal.close(); return true; }
    if (router.canGoBack()) { router.back(); return true; }
    return false;
  });
}
// Call the returned unsubscribe when your component unmounts.
// Async handlers must check their AbortSignal before UI changes after an await.
