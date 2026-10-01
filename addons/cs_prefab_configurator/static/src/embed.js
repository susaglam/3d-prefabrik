/**
 * The contract between the configurator in an iframe and the page that frames it.
 *
 * Both halves of the channel load THIS file — app.js imports it inside the frame, embed_host.js
 * imports it on the host page. That is deliberate: the namespace string and the two height bounds
 * are the whole protocol, and a protocol whose two ends keep their own copies of a constant drifts
 * silently. Renaming the namespace here renames it on both sides or on neither.
 *
 * Why the parent sizes the frame and the iframe only *advises*
 * ------------------------------------------------------------
 * The configurator is a viewport application, not a document: `body` is `overflow:hidden` and the
 * workspace is `height:100%`, so it fills whatever box it is given and its choices panel scrolls
 * inside itself. The usual "iframe reports scrollHeight, parent grows to match" pattern therefore
 * does not apply — `scrollHeight` is whatever height the frame already has, which is either a
 * collapsed frame or a feedback loop against the layout's own `dvh` rules.
 *
 * So the host page's stylesheet owns the height (a `clamp()` against the visitor's viewport) and
 * the frame sends the smallest height at which its two-column layout is still usable. The parent
 * may honour that as a `min-height`, and clamps the number before it does. Everything here treats
 * a message as input, never as instruction.
 */

/** The path that renders the configurator without the standalone header. Matched exactly. */
export const EMBED_PATH = '/prefab/embed';

/** Namespace on every message. Anything without it is somebody else's library talking. */
export const MESSAGE_SOURCE = 'cs-prefab';

/** The breakpoint at which styles.css stacks the workspace and gives the preview 35dvh. */
export const NARROW_QUERY = '(max-width: 900px)';

/**
 * Below these the layout is present but not workable: 620 px is the two-column desktop workspace
 * with the choices panel showing more than its heading, 560 px is the stacked phone layout with
 * the preview at 35dvh and a scrollable panel under it.
 */
export const MIN_HEIGHT_WIDE = 620;
export const MIN_HEIGHT_NARROW = 560;

/** What the host will accept from the frame, whatever the frame says. */
export const HEIGHT_FLOOR = 400;
export const HEIGHT_CEILING = 1200;

/** Message types the frame may send. An unknown type is dropped rather than forwarded. */
export const MESSAGE_TYPES = ['ready', 'size', 'step', 'submitted'];

/** True only for /prefab/embed and /prefab/embed/ — never for a path that merely starts with it. */
export function isEmbedded(pathname) {
  if (typeof pathname !== 'string' || !pathname) return false;
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return normalized === EMBED_PATH;
}

/** The smallest usable height for the layout the frame is currently in. */
export function minimumHeight(narrow) {
  return narrow ? MIN_HEIGHT_NARROW : MIN_HEIGHT_WIDE;
}

/**
 * A height the host is willing to apply, or null. Rejects anything that is not a finite number —
 * including the strings, NaN and Infinity that a hostile or broken sender would produce.
 */
export function clampAdvisedHeight(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.min(HEIGHT_CEILING, Math.max(HEIGHT_FLOOR, Math.round(value)));
}

/**
 * Validate one incoming `message` event and return the advice it carries, or null.
 *
 * Four independent gates, because each of them alone is insufficient:
 *   - `expectedOrigin` — the sender must be our own origin. Passing no origin fails closed.
 *   - `frameWindow` — and it must be THIS frame. Origin alone lets any same-origin frame on the
 *     page (an advert, another embed) resize the configurator.
 *   - `source` — namespaced, so another library's postMessage traffic is not mistaken for ours.
 *   - the payload is copied field by field; nothing from the message is forwarded unread.
 */
export function readAdvice(event, {expectedOrigin, frameWindow} = {}) {
  if (!event || typeof expectedOrigin !== 'string' || !expectedOrigin) return null;
  if (event.origin !== expectedOrigin) return null;
  if (frameWindow && event.source !== frameWindow) return null;
  const data = event.data;
  if (!data || typeof data !== 'object' || data.source !== MESSAGE_SOURCE) return null;
  if (!MESSAGE_TYPES.includes(data.type)) return null;
  const advice = {type: data.type, minHeight: clampAdvisedHeight(data.minHeight)};
  if (data.type === 'step') {
    advice.index = Number.isInteger(data.index) ? data.index : null;
    advice.label = typeof data.label === 'string' ? data.label.slice(0, 80) : '';
  }
  if (data.type === 'submitted') advice.reference = typeof data.reference === 'string' ? data.reference.slice(0, 64) : '';
  return advice;
}

/**
 * Frame side. Returns null when the page is not framed, so app.js can call it unconditionally.
 *
 * The target origin of every message is our OWN origin. If the parent turns out to be a different
 * origin the browser refuses to deliver, which is the behaviour we want: the same-origin embed is
 * the supported arrangement (see docs/website/odoo-target.md §5.2) and a cross-origin parent gets
 * silence rather than a channel nobody designed.
 */
export function startEmbedBridge({win = window, doc = document} = {}) {
  const parent = win.parent;
  if (!parent || parent === win) return null;
  const origin = win.location.origin;
  const narrow = () => !!win.matchMedia && win.matchMedia(NARROW_QUERY).matches;
  const send = (type, extra = {}) => {
    try {
      parent.postMessage({source: MESSAGE_SOURCE, type, minHeight: minimumHeight(narrow()), ...extra}, origin);
    } catch {
      /* A refused postMessage is not an error here: the host page's own clamp is the fallback. */
    }
  };
  let lastHeight = null;
  const advise = () => {
    const height = minimumHeight(narrow());
    if (height === lastHeight) return;
    lastHeight = height;
    send('size');
  };
  // Three independent triggers for one fact, because each of them can miss it on its own: a
  // ResizeObserver delivery can be dropped after a loop warning, a media query only fires on the
  // crossing itself, and `resize` does not fire when the frame is resized without the window
  // being. Observed: the frame stayed on the desktop minimum after a viewport change that all of
  // the first two should have caught.
  const query = win.matchMedia ? win.matchMedia(NARROW_QUERY) : null;
  const onChange = () => advise();
  query?.addEventListener?.('change', onChange);
  win.addEventListener?.('resize', onChange);
  let observer = null;
  if (typeof win.ResizeObserver === 'function' && doc.body) {
    observer = new win.ResizeObserver(() => advise());
    observer.observe(doc.body);
  }
  lastHeight = minimumHeight(narrow());
  send('ready');
  return {
    advise,
    step: (index, label) => send('step', {index, label}),
    submitted: (reference) => send('submitted', {reference}),
    dispose: () => {
      query?.removeEventListener?.('change', onChange);
      win.removeEventListener?.('resize', onChange);
      observer?.disconnect();
    },
  };
}

/**
 * Host side. Applies the frame's advice as a `min-height`, which is why the stylesheet's own
 * `height` stays in charge: the used height is the larger of the two, and the clamp above bounds
 * what the frame can ask for. A blocked or failed script leaves the stylesheet's height alone —
 * that is the fallback, not an error path.
 *
 * `step` scrolls the frame back into view only when its top has already scrolled off the screen,
 * and only on the narrow layout. On a desktop page the frame is fully visible and an unrequested
 * scroll is the single most irritating thing an embed can do.
 */
export function connectEmbedFrame(frame, {win = window, onAdvice} = {}) {
  if (!frame) return () => {};
  const expectedOrigin = win.location.origin;
  const handler = (event) => {
    const advice = readAdvice(event, {expectedOrigin, frameWindow: frame.contentWindow});
    if (!advice) return;
    if (advice.minHeight) frame.style.minHeight = advice.minHeight + 'px';
    if (advice.type === 'step' && win.matchMedia?.(NARROW_QUERY).matches) {
      const box = frame.getBoundingClientRect();
      if (box.top < 0) frame.scrollIntoView({block: 'start', behavior: 'smooth'});
    }
    frame.dataset.prefabEmbedState = advice.type;
    onAdvice?.(advice);
  };
  win.addEventListener('message', handler);
  return () => win.removeEventListener('message', handler);
}
