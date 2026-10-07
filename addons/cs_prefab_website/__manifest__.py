{
    "name": "CS Prefab Website",
    # Niet "tweede website": dit module maakt er geen. Het bouwt de site op de website die deze
    # Odoo al heeft -- dezelfde die de configurator op /prefab serveert.
    "summary": "prefabpartner.nl: huisstijl, pagina's, projecten, nieuws en de configurator",
    # Five components, as every module on this target carries. The packager asserts the
    # 'saas~19.4.' prefix and the deploy helper asserts this exact string, so the number is
    # bumped by hand -- it is deliberately NOT the configurator's 2.9.x series, because the
    # release helpers derive the next version by text-substituting that series.
    "version": "saas~19.4.1.4.1",
    "category": "Website",
    "license": "LGPL-3",
    "author": "Codesnap",
    "website": "https://codesnap.nl",
    # Without an explicit description Odoo parses README.md as reStructuredText and prints a
    # docutils warning per Markdown code fence on every upgrade -- in exactly the log that a
    # deploy is accepted from. Keep this short and plain; the reasoning lives in README.md.
    "description": (
        "Bouwt prefabpartner.nl OP de website die deze Odoo al heeft. Er wordt geen tweede "
        "website-record aangemaakt: de bestaande standaardwebsite krijgt de huisstijl, de "
        "vaste header en de voettekst, de beeldbank, de menu-items, elke pagina van de site, "
        "de projectgalerij als bewerkbare records, het nieuws in Odoo Blog en een 301 voor "
        "elke oude URL. De configurator op /prefab blijft op dezelfde website draaien. Het "
        "webadres (website.domain) wordt NOOIT door dit module ingevuld — dat is de knop die "
        "de configurator op 403 zet, en die zet je zelf om op het moment dat DNS verhuist. "
        "Installeert Odoo Blog (website_blog) mee voor de nieuwsberichten."
    ),
    "depends": [
        "website",
        # De nieuwsberichten staan in Odoo Blog; afhankelijk zijn maakt het installeren
        # onderdeel van een geteste, omkeerbare release in plaats van een klik in Apps.
        # Trekt website_partner mee.
        "website_blog",
        "crm",
        # Het contactformulier en het partnerformulier maken een crm.lead aan. website_crm is
        # wat crm.lead tot een formulierdoel maakt; het staat hier al geïnstalleerd, maar een
        # impliciete afhankelijkheid is geen afhankelijkheid.
        "website_crm",
        # De offertepagina's zijn de configurator. Dit module plaatst de pagina en zet de
        # catalogus- en vormgevingsrecords per website klaar, dus het hangt af van het module
        # dat die bezit.
        "cs_prefab_configurator",
        # Huisregel: elk cs_*-module hangt af van cs_security_base voor de gedeelde
        # "CS Modules"-categorie. cs_mcp_bridge mag hier nooit staan.
        "cs_security_base",
    ],
    "data": [
        # VOLGORDE IS BEPALEND. Beveiliging eerst: een datarecord dat een groep via ref()
        # opzoekt, doet dat terwijl het bestand wordt ingelezen, dus de groep moet er dan zijn.
        "security/ir.access.csv",

        # EERST: de eenmalige inrichting van de bestaande website (de vlag, de naam, het
        # menu, het logo, de taal). Dit bestand maakt GEEN website aan — het wijst de
        # bestaande standaardwebsite aan — en het moet vóór alle andere data draaien, want
        # elk record hieronder zoekt zijn website_id op via de vlag die hier wordt gezet.
        "data/website_data.xml",
        "data/media_data.xml",
        "data/redirect_data.xml",

        # Backend.
        "views/website_views.xml",
        "views/project_views.xml",

        # Chrome dat op elke pagina staat.
        "views/layout_templates.xml",
        "views/seo_templates.xml",

        # Snippets: eerst in de lade, dan de pagina's die ze aanroepen.
        "views/snippets/s_prefab_usp.xml",
        "views/snippets/s_prefab_diensten.xml",
        "views/snippets/s_prefab_hotspots.xml",

        # De pagina's.
        "views/news_templates.xml",
        "views/page_home.xml",
        "views/page_oplossingen.xml",
        "views/page_overige.xml",
        "views/project_templates.xml",
        "views/offerte_templates.xml",

        # Na de sjablonen: de website.page-records verwijzen met ref() naar de views hierboven,
        # en die verwijzing wordt opgelost tijdens het inlezen.
        "data/page_data.xml",
        "data/blog_data.xml",
        "data/project_data.xml",

        # ALS LAATSTE: "/" toewijzen aan de startpagina van dit module en de startpagina die
        # de website al had opzij zetten. Dat kan pas als data/page_data.xml onze pagina
        # heeft aangemaakt, dus dit bestand staat onderaan en niet bij de andere data.
        "data/homepage_data.xml",
    ],
    "assets": {
        # DELIBERATELY EMPTY, and it is the load-bearing decision of this module's styling.
        #
        # _assets_primary_variables is per-INSTANCE. An earlier version of this module put a
        # brand palette here and merged it into $o-color-palettes; Odoo resolves the gray and
        # the theme palette by the SAME name as the colour palette, found neither, and raised
        # "Incompatible units: '%' and 'px'" -- which stopped web.assets_frontend compiling
        # for every website on this Odoo, the customer's existing live site included.
        #
        # The brand is not a bundle. It is written per website into the same customisation
        # files Odoo's own Theme tab writes, by models/website.py::_cs_prefab_apply_theme.
        # That is why the customer can open Vormgeving and change any of it.
        "web._assets_primary_variables": [],
        # Everything here is downloaded, parsed and EXECUTED on every page of every website
        # on this instance -- asset bundles are per instance, not per website. So this stays
        # small, and every rule and every line of script is scoped to .o_prefab_site (a body
        # class this module only puts on the new website). Website 1 downloads it, matches
        # nothing, and the script returns on its first line.
        "web.assets_frontend": [
            "cs_prefab_website/static/src/scss/prefab_site.scss",
            "cs_prefab_website/static/src/scss/prefab_warm.scss",
            "cs_prefab_website/static/src/scss/prefab_home.scss",
            "cs_prefab_website/static/src/scss/prefab_motion.scss",
            "cs_prefab_website/static/src/js/prefab_site.js",
            "cs_prefab_website/static/src/js/prefab_home_motion.js",
            # "Je ontwerp staat klaar" (2.18.0): two files of their own, as docs/resume-card-contract.md settled.
            "cs_prefab_website/static/src/scss/resume_bar.scss",
            "cs_prefab_website/static/src/js/resume_bar.js",
        ],
    },
    "installable": True,
    # False on purpose: this module has no application of its own. Its backend surface is a
    # Projecten entry under Website and a handful of fields on the Website settings form.
    "application": False,
    "auto_install": False,
}
