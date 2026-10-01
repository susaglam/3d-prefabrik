"""Durable local repository; the Odoo adapter uses ORM records instead."""
import json
import copy
import os
from pathlib import Path
import re
import secrets
import sqlite3
import time
from datetime import datetime, timezone

from .configuration import canonical_config, canonical_json, canonical_quote_payload, config_labels
from .errors import DomainError
from .pricing import price_config
from .catalog import current_release, release_context, check_revision, get_catalog, get_pricebook, make_release, DATA_DIR
import uuid

TOKEN_PATTERN = re.compile(r"^[A-Za-z0-9_-]{43}$")
SHARE_TTL = 30 * 24 * 3600
QUOTE_TTL = 90 * 24 * 3600


def valid_token(token):
    return isinstance(token, str) and bool(TOKEN_PATTERN.fullmatch(token))


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _model_policy_projection(policies):
    """Freeze the full model resolver, without copying mutable commercial prices."""
    return {key: {"assetKey": policy.get("assetKey", key),
                  "choices": {value: {"assetKey": choice.get("assetKey", key)}
                              for value, choice in policy.get("choices", {}).items()}}
            for key, policy in policies.items()}


def new_snapshot(canonical):
    with release_context() as release:
        price = price_config(canonical["config"])
        snapshot = {"snapshotVersion": 2, "catalogRevision": release["revision"], "assetRevision": release["catalog"]["assetRevision"], "catalogDefinition": get_catalog(),
                    "config": price["config"], "labels": config_labels(price["config"]), "price": price,
                    "scope": copy.deepcopy(price["scope"]), "modelPolicies": _model_policy_projection(release["policies"]), "createdAt": utc_now(),
                    "consent": {"accepted": True, "textVersion": "quote-contact-v1"}}
        if "visuals" in canonical:
            snapshot["visuals"] = copy.deepcopy(canonical["visuals"])
        if release.get("commercialApproval"):
            snapshot["commercialApproval"] = copy.deepcopy(release["commercialApproval"])
        return snapshot


def submission_key(payload):
    try:
        value = payload.get("idempotencyKey") if isinstance(payload, dict) else None
        parsed = uuid.UUID(value) if isinstance(value, str) else None
        if parsed is None or parsed.version != 4:
            raise ValueError()
        return str(parsed)
    except (ValueError, AttributeError):
        raise DomainError("Ongeldige aanvraagcode.") from None


def _retry_model_policies(snapshot, catalog):
    if isinstance(snapshot.get("modelPolicies"), dict):
        return copy.deepcopy(snapshot["modelPolicies"])

    # Historical snapshots saved the resolved asset only for selected items.
    # Restore that exact choice; do not assume it was also the admin default.
    policies = {}
    config = snapshot.get("config", {})
    for item in snapshot.get("price", {}).get("scope", snapshot.get("scope", [])):
        key = item["key"]
        value = str(config.get(key))
        policies[key] = {"assetKey": key, "choices": {value: {"assetKey": item.get("assetKey", key)}}}

    # A rejected radiator has no scope row. Its saved availability can still
    # identify its envelope uniquely. Compare geometry evidence, never hashes
    # or candidate request payloads. Ambiguous/missing evidence stays legacy
    # default, so we may reject an unrecoverable retry rather than guess.
    rules = catalog.get("geometryRules", {})
    saved_heating = snapshot.get("price", {}).get("allowedPositions", {}).get("heating")
    if rules.get("version") == 1 and isinstance(saved_heating, list) and config.get("interior"):
        from .geometry_rules import mounting_state
        candidates = {asset: mounting_state(config, rules, {"heating": asset},
                        asset_revision=catalog.get("assetRevision"))["allowedPositions"]["heating"]
                      for asset in ("heating", "heating-panel")}
        choices = policies.setdefault("heating", {"assetKey": "heating", "choices": {}})["choices"]
        for value in ("left", "right", "both"):
            matching = [asset for asset, allowed in candidates.items() if (value in allowed) == (value in saved_heating)]
            if value not in choices and len(matching) == 1:
                choices[value] = {"assetKey": matching[0]}
    return policies


def retry_payload(payload, snapshot):
    """Validate a retry against the original schema, including pre-v2 snapshots."""
    catalog = snapshot.get("catalogDefinition")
    if catalog is None:
        catalog = json.loads((DATA_DIR / "catalog.legacy-v1.json").read_text(encoding="utf-8"))
    policies = _retry_model_policies(snapshot, catalog)
    with release_context(make_release(catalog, get_pricebook(), policies, revision=snapshot.get("catalogRevision", "legacy-v1"))):
        return canonical_quote_payload(payload)


class ClosingConnection(sqlite3.Connection):
    def __exit__(self, *args):
        try:
            return super().__exit__(*args)
        finally:
            self.close()


class SQLiteRepository:
    def __init__(self, path, scope="local:1:1"):
        self.path = str(path)
        self.scope = scope
        parent = Path(path).resolve().parent
        parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        self._initialize()
        try:
            os.chmod(path, 0o600)
        except OSError:
            pass

    def connect(self):
        connection = sqlite3.connect(self.path, timeout=15, factory=ClosingConnection)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        return connection

    def _initialize(self):
        with self.connect() as db:
            db.execute("PRAGMA journal_mode = WAL")
            db.executescript("""
                CREATE TABLE IF NOT EXISTS shares (
                    token TEXT PRIMARY KEY, scope TEXT NOT NULL, config_json TEXT NOT NULL,
                    created_at TEXT NOT NULL, expires_at REAL NOT NULL
                );
                CREATE TABLE IF NOT EXISTS quotes (
                    id INTEGER PRIMARY KEY AUTOINCREMENT, scope TEXT NOT NULL,
                    idempotency_key TEXT NOT NULL, payload_hash TEXT NOT NULL,
                    token TEXT NOT NULL UNIQUE, reference TEXT NOT NULL UNIQUE,
                    snapshot_json TEXT NOT NULL, contact_json TEXT NOT NULL,
                    created_at TEXT NOT NULL, expires_at REAL NOT NULL,
                    UNIQUE(scope, idempotency_key)
                );
                CREATE TRIGGER IF NOT EXISTS immutable_quote_snapshot
                BEFORE UPDATE ON quotes BEGIN SELECT RAISE(ABORT, 'Quote snapshots are immutable'); END;
                CREATE INDEX IF NOT EXISTS shares_expiry ON shares(expires_at);
                CREATE INDEX IF NOT EXISTS quotes_expiry ON quotes(expires_at);
            """)

    def health(self):
        with self.connect() as db:
            db.execute("SELECT 1").fetchone()
        return {"ok": True, "storage": "sqlite", "mode": "development", "emailDelivery": False}

    def create_share(self, config):
        config = canonical_config(config)
        # Shared links deliberately carry no contact record or location data.
        config["postcode"] = ""
        saved = {"config": config, "catalogRevision": current_release()["revision"], "schemaVersion": str(get_catalog()["schemaVersion"])}
        token = secrets.token_urlsafe(32)
        with self.connect() as db:
            db.execute("INSERT INTO shares VALUES (?, ?, ?, ?, ?)",
                       (token, self.scope, canonical_json(saved), utc_now(), time.time() + SHARE_TTL))
        return {"token": token, "url": f"/prefab?share={token}", "expiresInDays": 30}

    def get_share(self, token):
        if not valid_token(token):
            raise DomainError("Deze deellink is niet gevonden of verlopen.", code="not_found", status=404)
        with self.connect() as db:
            row = db.execute("SELECT config_json FROM shares WHERE token = ? AND scope = ? AND expires_at > ?",
                             (token, self.scope, time.time())).fetchone()
        if not row:
            raise DomainError("Deze deellink is niet gevonden of verlopen.", code="not_found", status=404)
        saved = json.loads(row["config_json"])
        return saved if "config" in saved else {"config": saved, "catalogRevision": None, "schemaVersion": "1.0"}

    @staticmethod
    def quote_result(row):
        snapshot = json.loads(row["snapshot_json"])
        return {"reference": row["reference"], "token": row["token"], "pdfUrl": f"/prefab/api/quote/{row['token']}/pdf",
                "price": snapshot["price"], "createdAt": row["created_at"], "emailSent": False}

    def create_quote(self, payload):
        key = submission_key(payload)
        # Serialize the idempotency lookup/create across request threads/processes.
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            existing = db.execute("SELECT * FROM quotes WHERE scope = ? AND idempotency_key = ?", (self.scope, key)).fetchone()
            if existing:
                canonical, _, payload_hash = retry_payload(payload, json.loads(existing["snapshot_json"]))
                if not secrets.compare_digest(existing["payload_hash"], payload_hash):
                    raise DomainError("Deze aanvraagcode is al gebruikt voor een andere aanvraag. Probeer opnieuw.", code="idempotency_conflict", status=409)
                return self.quote_result(existing)
            with release_context():
                check_revision(payload.get("catalogRevision"))
                canonical, _, payload_hash = canonical_quote_payload(payload)
                snapshot = new_snapshot(canonical)
            token = secrets.token_urlsafe(32)
            reference = f"CS-{datetime.now(timezone.utc):%Y%m%d}-{secrets.token_hex(4).upper()}"
            db.execute("""INSERT INTO quotes (scope,idempotency_key,payload_hash,token,reference,snapshot_json,
                contact_json,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?)""",
                (self.scope, key, payload_hash, token, reference, canonical_json(snapshot), canonical_json(canonical["contact"]), snapshot["createdAt"], time.time() + QUOTE_TTL))
            row = db.execute("SELECT * FROM quotes WHERE token = ?", (token,)).fetchone()
            return self.quote_result(row)

    def get_quote(self, token):
        if not valid_token(token):
            raise DomainError("Deze aanvraag is niet gevonden of verlopen.", code="not_found", status=404)
        with self.connect() as db:
            row = db.execute("SELECT * FROM quotes WHERE token = ? AND scope = ? AND expires_at > ?", (token, self.scope, time.time())).fetchone()
        if not row:
            raise DomainError("Deze aanvraag is niet gevonden of verlopen.", code="not_found", status=404)
        return {"reference": row["reference"], "snapshot": json.loads(row["snapshot_json"]), "contact": json.loads(row["contact_json"])}

    def purge_expired(self):
        with self.connect() as db:
            shares = db.execute("DELETE FROM shares WHERE expires_at <= ?", (time.time(),)).rowcount
            quotes = db.execute("DELETE FROM quotes WHERE expires_at <= ?", (time.time(),)).rowcount
        return {"shares": shares, "quotes": quotes}
