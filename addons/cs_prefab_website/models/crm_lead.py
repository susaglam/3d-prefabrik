"""Weiger een formulierinzending zonder onderwerp, in plaats van er een 500 van te maken.

DE FOUT DIE DIT AFVANGT ZIT IN DE KERN, niet in dit module, en hij is stil. Deze drie regels
staan in ``website/controllers/form.py`` van dit image (regel 252-254)::

    missing_required_fields = [label for label, field in authorized_fields.items()
                               if field['required'] and label not in data['record']]
    if any(error_fields):
        raise ValidationError(error_fields + missing_required_fields)

De weigering hangt dus aan ``error_fields`` -- de velden met een FOUTE waarde -- en niet aan
``missing_required_fields``. Bij een net getypte inzending waarin een verplicht veld simpelweg
ONTBREEKT is ``error_fields`` leeg, wordt de hele lijst weggegooid, en loopt de controller door
naar ``insert_record``.

Wat daarna gebeurt is het echte probleem. ``crm.lead.name`` is NOT NULL, dus de INSERT werpt een
IntegrityError; ``_handle_website_form`` vangt die af met ``except IntegrityError: return
json.dumps(False)`` (regel 90-91) *zonder* rollback, en de aanroeper doet daarna
``self.env.cr.commit()`` (regel 42) op een transactie die al is afgebroken. Postgres antwoordt
InFailedSqlTransaction en de bezoeker krijgt een 500 -- een witte pagina, geen melding, en niets
in de mailbox. Gemeten op de kloon als "ERROR: null value in column \"name\" of relation
\"crm_lead\" violates not-null constraint", gevolgd door die commit in de traceback.

WAAROM UserError EN NIET ValidationError. Beide worden afgevangen, maar niet op dezelfde plek en
niet met hetzelfde antwoord:

* ``ValidationError`` uit ``extract_data`` wordt opgevangen door ``_handle_website_form`` zelf en
  komt terug als ``{'error_fields': [...]}``. Het formulier-widget kleurt daarmee de genoemde
  velden rood (``form.js:418``) -- maar het onderwerp van deze formulieren is een verborgen veld,
  dus de bezoeker ziet niets rood worden en leest geen enkele zin.
* ``UserError`` gaat door tot ``website_form``, dat ``(ValidationError, UserError)`` afvangt,
  ``cr.rollback()`` doet en ``{'error': <bericht>}`` teruggeeft. Precies dat bericht rendert het
  widget als statusmelding (``form.js:417``). Dat is de enige variant waarin de bezoeker
  leest wat er mis is.

Beide geven HTTP 200 en laten geen halve lead achter; het verschil is of er iets te lezen valt.

WAAROM OP HET MODEL EN NIET OP DE CONTROLLER. Een override van ``extract_data`` zou de kernfout
voor élk formulierdoel op deze Odoo repareren, ook die van de bestaande website -- verleidelijk,
maar het is precies het soort instantiebrede ingreep dat deze release belooft niet te doen. Deze
haak zit op ``crm.lead`` en verandert daar alleen een 500 in een leesbare weigering: een lead
zonder ``name`` kón sowieso niet bestaan, op geen enkele website van deze instantie.
"""
from odoo import _, models
from odoo.exceptions import UserError


class CrmLead(models.Model):
    _inherit = "crm.lead"

    def website_form_input_filter(self, request, values):
        """Vul aan wat de kern aanvult, en weiger wat de kern stilzwijgend doorlaat.

        ``super()`` eerst: website_crm zet hier ``medium_id``, ``team_id``, ``user_id`` en
        ``type``. Die horen ook op een inzending die daarna alsnog wordt geweigerd -- de
        weigering mag niet afhangen van de volgorde waarin twee modules hetzelfde veld vullen.
        """
        values = super().website_form_input_filter(request, values)
        if not (values.get("name") or "").strip():
            raise UserError(_(
                "Je bericht is niet verstuurd: het onderwerp van de aanvraag ontbreekt. "
                "Ververs deze pagina en verstuur het formulier opnieuw. Blijft het misgaan, "
                "mail ons dan rechtstreeks — dan gaat er zeker niets verloren."))
        return values
