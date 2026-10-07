/**
 * "Je ontwerp staat klaar" (2.18.0): a small bar on the website for a visitor who made a design and has not sent it.
 *
 * It implements docs/resume-card-contract.md as agreed with the customer on 2026-09-21, and reads ONLY the resume
 * cards a configurator publishes under `cs-resume-v1` — never a configurator's own draft. Product-neutral on purpose:
 * a dakkapel or veranda configurator appears here by writing a card, without a line of website code.
 *
 * Rules (the contract's): the most recent card wins; nothing older than 30 days; never on the page the card points
 * at nor on a page that carries the configurator; the price only when the card was priced on the catalogue this site
 * serves now; the × hides one product for 7 days and a fresh save of that product clears it; anything unreadable
 * means no bar, silently — a broken card may never break a page.
 *
 * Like prefab_site.js this is a plain script, no Odoo module marker: web.assets_frontend is per instance, so it runs
 * on every website of this Odoo and returns at once without `.o_prefab_site`, or when Vormgeving → "Doorgaan-melding
 * tonen" is off (the layout then leaves out `data-cs-resume` on <body>). `csResumeBar` exposes the pure rules for
 * tests/frontend/resume_card.test.mjs.
 */
(function () {
    'use strict';
    var KEY = 'cs-resume-v1';
    var DISMISSED = 'cs-resume-dismissed-v1';
    var DAY = 864e5;
    var STALE = 30 * DAY;
    var QUIET = 7 * DAY;

    function read(storage, key) {
        try {
            var value = JSON.parse(storage.getItem(key) || '{}');
            return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
        } catch (error) {
            return {};
        }
    }

    function pathOf(url) {
        return String(url).split(/[?#]/)[0];
    }

    function valid(card) {
        return !!card && typeof card === 'object' && !Array.isArray(card)
            && typeof card.label === 'string' && !!card.label.trim() && card.label.length <= 60
            && typeof card.url === 'string' && /^\/(?![/\\])/.test(card.url)
            && isFinite(Date.parse(card.savedAt));
    }

    /** The card to show, as {product, card, showPrice}, or null. Pure: everything it depends on is passed in. */
    function pick(cards, options) {
        if (!cards || typeof cards !== 'object' || Array.isArray(cards)) {
            return null;
        }
        var best = null;
        Object.keys(cards).forEach(function (product) {
            var card = cards[product];
            if (!valid(card)) {
                return;
            }
            var saved = Date.parse(card.savedAt);
            if (options.now - saved > STALE || pathOf(card.url) === options.path) {
                return;
            }
            var gone = Date.parse((options.dismissed || {})[product]);
            if (isFinite(gone) && gone >= saved && options.now - gone < QUIET) {
                return;
            }
            if (!best || saved > best.saved) {
                best = {product: product, card: card, saved: saved};
            }
        });
        if (!best) {
            return null;
        }
        var priced = Number.isInteger(best.card.total) && best.card.total > 0;
        return {product: best.product, card: best.card, showPrice: priced && !!best.card.revision && best.card.revision === options.revision};
    }

    function priceText(cents) {
        return new Intl.NumberFormat('nl-NL', {style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 0})
            .format(cents / 100).replace(/ /g, ' ');
    }

    var api = {KEY: KEY, DISMISSED: DISMISSED, pick: pick, read: read, priceText: priceText};
    (typeof globalThis !== 'undefined' ? globalThis : this).csResumeBar = api;
    if (typeof document === 'undefined') {
        return;
    }

    function cookieBarOpen() {
        var element = document.getElementById('website_cookies_bar');
        return !!element && element.offsetParent !== null && getComputedStyle(element).display !== 'none';
    }

    function show(choice) {
        var bar = document.createElement('aside');
        bar.className = 'cs-resume-bar';
        bar.setAttribute('aria-label', 'Je ontwerp staat klaar');
        var link = document.createElement('a');
        link.className = 'cs-resume-bar__link';
        link.href = choice.card.url;
        var title = document.createElement('strong');
        title.className = 'cs-resume-bar__title';
        title.textContent = 'Je ontwerp staat klaar';
        var detail = document.createElement('span');
        detail.className = 'cs-resume-bar__detail';
        detail.textContent = choice.card.label;
        if (choice.showPrice) {
            var price = document.createElement('span');
            price.className = 'cs-resume-bar__price';
            price.textContent = priceText(choice.card.total);
            detail.appendChild(document.createTextNode(' · '));
            detail.appendChild(price);
        }
        var go = document.createElement('span');
        go.className = 'cs-resume-bar__go';
        go.textContent = 'Verder';
        link.appendChild(title);
        link.appendChild(detail);
        link.appendChild(go);
        var close = document.createElement('button');
        close.type = 'button';
        close.className = 'cs-resume-bar__close';
        close.setAttribute('aria-label', 'Melding verbergen');
        close.textContent = '×';
        close.addEventListener('click', function () {
            try {
                var dismissed = read(window.localStorage, DISMISSED);
                dismissed[choice.product] = new Date().toISOString();
                window.localStorage.setItem(DISMISSED, JSON.stringify(dismissed));
            } catch (error) { /* without storage the × still closes it for this page */ }
            bar.remove();
        });
        bar.appendChild(link);
        bar.appendChild(close);
        document.body.appendChild(bar);
        // Two frames: the bar is laid out hidden first, so the slide-in has a start (none with reduced motion, see scss).
        window.requestAnimationFrame(function () {
            window.requestAnimationFrame(function () { bar.classList.add('is-visible'); });
        });
    }

    function start() {
        try {
            var body = document.body;
            if (!body || !body.classList.contains('o_prefab_site') || !body.hasAttribute('data-cs-resume')) {
                return;
            }
            // Not in the website builder, not inside a frame, not on a page that carries the configurator itself.
            if (window.self !== window.top || body.classList.contains('editor_enable') || document.querySelector('[data-prefab-embed]')) {
                return;
            }
            var choice = pick(read(window.localStorage, KEY), {
                now: Date.now(), path: window.location.pathname, revision: body.getAttribute('data-cs-resume'),
                dismissed: read(window.localStorage, DISMISSED),
            });
            if (!choice) {
                return;
            }
            // The cookie notice speaks first; the bar waits until it is answered (or gives up after a minute).
            var waited = 0;
            (function wait() {
                if (cookieBarOpen() && waited < 60) {
                    waited += 1;
                    window.setTimeout(wait, 1000);
                    return;
                }
                show(choice);
            })();
        } catch (error) { /* a broken card may never break a page */ }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }
})();
