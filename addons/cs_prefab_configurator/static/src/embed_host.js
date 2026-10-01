/**
 * The host page's half of the embed, loaded by the website page that frames the configurator.
 *
 * It is one file for one reason: everything it does is in embed.js, which the frame loads too, so
 * the namespace and the height bounds have exactly one definition. It is loaded per page rather
 * than through web.assets_frontend because asset bundles are per INSTANCE — a bundle entry would
 * be downloaded, parsed and executed on every page of every website on this Odoo, to be used on
 * two of them.
 *
 * If this script never runs — blocked, failed, an old browser — the frame keeps the height its
 * stylesheet gives it and the configurator works. That is the designed fallback, not a failure.
 */
const version = new URL(import.meta.url).searchParams.get('v');
import('./embed.js' + (version ? '?v=' + encodeURIComponent(version) : ''))
  .then(({connectEmbedFrame}) => {
    for (const frame of document.querySelectorAll('iframe[data-prefab-embed]')) connectEmbedFrame(frame);
  })
  .catch(() => {
    /* Deliberately silent: the stylesheet's clamp is already a working height. */
  });
