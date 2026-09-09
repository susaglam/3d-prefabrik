{
    "name": "CS Prefab Configurator",
    "summary": "Prefab aanbouw configurator met servervalidatie, CRM-aanvraag en PDF",
    "version": "saas~19.3.1.0.0",
    "category": "Website",
    "license": "LGPL-3",
    "author": "Codesnap",
    "depends": ["website", "crm"],
    "data": [
        "security/security.xml",
        "security/ir.model.access.csv",
        "views/quote_views.xml",
        "report/quote_report.xml",
        "data/cron.xml",
    ],
    "installable": True,
    "application": True,
}
