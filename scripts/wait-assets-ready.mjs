/**
 * Bounded wait for `window.__prefabPreview.assetsReady`. Every acceptance script awaits this promise straight
 * (`page.evaluate(()=>window.__prefabPreview.assetsReady)`), which is normally done in 1-5s — but `evaluate()` has
 * no timeout of its own, so on the rare run where one of the ~40 parallel texture/HDR fetches inside `loadAssets()`
 * never settles (observed after several full-page reloads in one script — never in isolation), the whole gate hangs
 * forever with no error, no stack, nothing in the log after the last PASS line. A gate that hangs silently is worse
 * than one that fails (2.9 known limits). This turns that silent stall into a readable timeout error instead.
 */
export const waitAssetsReady = (target, ms = 45000) => Promise.race([
  target.evaluate(() => window.__prefabPreview.assetsReady),
  new Promise((_, reject) => setTimeout(() => reject(new Error('assetsReady did not settle within ' + ms + 'ms')), ms)),
]);
