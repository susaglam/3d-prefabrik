"""The frame policy of the configurator, and the embed address the site's offerte pages use.

Why this file exists at all. Before the embed work, `/prefab` answered with no `X-Frame-Options`
and no `Content-Security-Policy` -- measured twice in docs/website/odoo-target.md §5.1, once by
reading `web/controllers/home.py` and `odoo/http/router.py` (Odoo sets a frame policy on `/odoo`
and `/web/login` and nowhere else) and once with a real HTTPS request to the live instance. So the
page that creates CRM leads could be framed by any site on the internet.

Embedding it in the new website needed nothing loosened, then. It needed this tightened, and the
tightening is the thing worth a test: the failure it guards against is not a crash but a header
quietly widened in a later edit, after which the configurator is framable by a third party again
and everything still looks fine.

The values below are written out as literals on purpose. Asserting them against the constant in
controllers/main.py would pass whatever that constant says, which is exactly the edit this is here
to catch.
"""
from odoo.tests import HttpCase, tagged


@tagged("post_install", "-at_install")
class TestPrefabEmbed(HttpCase):

    def test_the_standalone_page_carries_a_frame_policy_it_did_not_have_before(self):
        response = self.url_open("/prefab")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["X-Frame-Options"], "SAMEORIGIN")
        self.assertEqual(response.headers["Content-Security-Policy"], "frame-ancestors 'self'")
        # The headers that were already there stay there.
        self.assertEqual(response.headers["Referrer-Policy"], "no-referrer")
        self.assertEqual(response.headers["X-Content-Type-Options"], "nosniff")

    def test_the_embed_address_serves_the_same_page(self):
        """Byte for byte. The page reads its own path; nothing else differs."""
        standalone = self.url_open("/prefab")
        embedded = self.url_open("/prefab/embed")
        self.assertEqual(embedded.status_code, 200)
        self.assertEqual(embedded.content, standalone.content)
        self.assertIn("text/html", embedded.headers["Content-Type"])

    def test_the_embed_address_carries_the_same_frame_policy(self):
        response = self.url_open("/prefab/embed")
        self.assertEqual(response.headers["X-Frame-Options"], "SAMEORIGIN")
        self.assertEqual(response.headers["Content-Security-Policy"], "frame-ancestors 'self'")

    def test_no_third_party_origin_may_be_added_without_this_test_failing(self):
        """The one assertion this file is really for.

        `frame-ancestors` is the only directive in the policy and `'self'` is its only source. A
        later edit that adds a host -- for a partner site, a preview service, a marketing tool --
        fails here and has to be a decision somebody took on purpose.

        And if such an origin is ever genuinely needed, `X-Frame-Options` has to be dropped in the
        same edit: the header has no multi-origin form, `ALLOW-FROM` is dead in every current
        browser, and a browser that honours both applies the stricter of the two -- which would be
        the one you did not want.
        """
        for url in ("/prefab", "/prefab/embed"):
            policy = self.url_open(url).headers["Content-Security-Policy"]
            directives = [part.strip() for part in policy.split(";") if part.strip()]
            self.assertEqual(directives, ["frame-ancestors 'self'"], url)
            self.assertNotIn("http", policy, url)
            self.assertNotIn("*", policy, url)

    def test_the_embed_address_is_not_offered_to_search_engines(self):
        """Two independent controls, and this is the one a crawler actually reads.

        The route is `sitemap=False`, so the address is never published in /sitemap.xml -- that
        half is asserted statically in tests/test_website_foundation.py, because a routing flag is
        not observable from a response. This half covers the crawler that found the URL some other
        way: the page itself says noindex, and it has said so since long before the embed existed.
        """
        body = self.url_open("/prefab/embed").content.decode("utf-8")
        self.assertIn('<meta name="robots" content="noindex,nofollow">', body)

    def test_the_embed_address_answers_only_GET(self):
        """It is a page, not an endpoint. A POST to it must not be a second way into anything.

        405 is what the routing map produces and 404 is what a website request handler may turn
        that into; both are refusals and which one arrives is Odoo's business. What is asserted is
        that a POST is not served, because that is the claim -- the route declares methods=["GET"]
        and the static check in tests/test_backend.py holds that declaration in place.
        """
        # `method="POST"` explicitly, NOT an empty body. saas~19.4's HttpCase.url_open reads
        # `if not method and (data or files or json): method = 'POST'`, so a falsy body such as b""
        # leaves the method at GET: the first version of this test asked for a page, got the page,
        # and reported the route as broken. Measured on the release image, 2026-09-17.
        response = self.url_open("/prefab/embed", method="POST", data=b"x", headers={"Content-Type": "text/plain"})
        self.assertIn(response.status_code, (404, 405), response.status_code)
