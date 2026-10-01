# Prefab application icon

`icon.svg` is the editable source; `icon.png` is its 128 × 128 raster export for the native Odoo application menu. The flat roof, broad glazed opening and side panel refer to the configurator's prefab extension.

The orange (`#e9521d`) and charcoal (`#1a1a1a`) come from the user-supplied [Prefab Partner logo](../vendor/logo-prefab-partner.svg). The icon geometry is authored in this repository; it has no external image or font dependency. The PNG was rendered directly from the SVG with Chromium, preserving transparent outer corners.

The root menu in [quote_views.xml](../../views/quote_views.xml) sets `web_icon="cs_prefab_configurator,static/description/icon.png"`. Odoo saas-19.4 reads this asset when the menu is created or updated; changing the PNG requires a module upgrade to refresh the stored menu image.
