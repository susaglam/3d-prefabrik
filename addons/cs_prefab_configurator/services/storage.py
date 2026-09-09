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

TOKEN_PATTERN = re.compile(r"^[A-Za-z0-9_-]{43}$")
SHARE_TTL = 30 * 24 * 3600
QUOTE_TTL = 90 * 24 * 3600


def valid_token(token):
    return isinstance(token, str) and bool(TOKEN_PATTERN.fullmatch(token))


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def new_snapshot(canonical):
    price = price_config(canonical["config"])
    snapshot = {"config": price["config"], "labels": config_labels(price["config"]), "price": price,
            "createdAt": utc_now(), "consent": {"accepted": True, "textVersion": "quote-contact-v1"}}
    if "visuals" in canonical:
        snapshot["visuals"] = copy.deepcopy(canonical["visuals"])
    return snapshot


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
        connection = sqlite3.connect(self.path, timeout=15)
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
        token = secrets.token_urlsafe(32)
        with self.connect() as db:
            db.execute("INSERT INTO shares VALUES (?, ?, ?, ?, ?)",
                       (token, self.scope, canonical_json(config), utc_now(), time.time() + SHARE_TTL))
        return {"token": token, "url": f"/prefab?share={token}", "expiresInDays": 30}

    def get_share(self, token):
        if not valid_token(token):
            raise DomainError("Deze deellink is niet gevonden of verlopen.", code="not_found", status=404)
        with self.connect() as db:
            row = db.execute("SELECT config_json FROM shares WHERE token = ? AND scope = ? AND expires_at > ?",
                             (token, self.scope, time.time())).fetchone()
        if not row:
            raise DomainError("Deze deellink is niet gevonden of verlopen.", code="not_found", status=404)
        return {"config": json.loads(row["config_json"])}

    @staticmethod
    def quote_result(row):
        snapshot = json.loads(row["snapshot_json"])
        return {"reference": row["reference"], "token": row["token"], "pdfUrl": f"/prefab/api/quote/{row['token']}/pdf",
                "price": snapshot["price"], "createdAt": row["created_at"], "emailSent": False}

    def create_quote(self, payload):
        canonical, key, payload_hash = canonical_quote_payload(payload)
        # Serialize the idempotency lookup/create across request threads/processes.
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            existing = db.execute("SELECT * FROM quotes WHERE scope = ? AND idempotency_key = ?", (self.scope, key)).fetchone()
            if existing:
                if not secrets.compare_digest(existing["payload_hash"], payload_hash):
                    raise DomainError("Deze aanvraagcode is al gebruikt voor een andere aanvraag. Probeer opnieuw.", code="idempotency_conflict", status=409)
                return self.quote_result(existing)
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
