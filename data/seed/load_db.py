#!/usr/bin/env python3
"""
Load seed JSON files into SQLite database with relational schema,
foreign keys, and views for common agent queries.

Usage:
    python load_db.py

Creates: evergreen.db in the same directory as this script.
"""

import json
import sqlite3
import os
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
DB_PATH = SCRIPT_DIR / "evergreen.db"

JSON_FILES = {
    "clients": SCRIPT_DIR / "clients.json",
    "policies": SCRIPT_DIR / "policies.json",
    "communications": SCRIPT_DIR / "communications.json",
    "quotes": SCRIPT_DIR / "quotes.json",
    "documents": SCRIPT_DIR / "documents.json",
}


def create_schema(conn: sqlite3.Connection) -> None:
    conn.executescript("""
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS clients (
            id                      TEXT PRIMARY KEY,
            first_name              TEXT NOT NULL,
            last_name               TEXT NOT NULL,
            dob                     TEXT NOT NULL,
            email                   TEXT NOT NULL,
            phone                   TEXT NOT NULL,
            address_street          TEXT NOT NULL,
            address_city            TEXT NOT NULL,
            address_state           TEXT NOT NULL,
            address_zip             TEXT NOT NULL,
            driver_license_number   TEXT,
            occupation              TEXT,
            marital_status          TEXT CHECK(marital_status IN ('single','married','divorced','widowed')),
            household_id            TEXT,
            preferred_contact_method TEXT CHECK(preferred_contact_method IN ('email','sms','phone')),
            preferred_contact_time  TEXT CHECK(preferred_contact_time IN ('morning','afternoon','evening')),
            status                  TEXT CHECK(status IN ('active','inactive','prospect')) DEFAULT 'active',
            engagement_score        INTEGER,
            last_email_open         TEXT,
            created_at              TEXT NOT NULL,
            updated_at              TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS client_accidents (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            client_id   TEXT NOT NULL REFERENCES clients(id),
            date        TEXT NOT NULL,
            type        TEXT NOT NULL,
            description TEXT
        );

        CREATE TABLE IF NOT EXISTS policies (
            policy_id           TEXT PRIMARY KEY,
            client_id           TEXT NOT NULL REFERENCES clients(id),
            carrier_code        TEXT NOT NULL CHECK(carrier_code IN ('TRAV','PROG','HRTF','ERIE','NTNW','SAFECO','LIBT')),
            policy_type         TEXT NOT NULL CHECK(policy_type IN (
                'personal_auto','homeowners','renters','umbrella',
                'bop','workers_comp','general_liability','professional_liability'
            )),
            effective_date      TEXT NOT NULL,
            expiration_date     TEXT NOT NULL,
            premium_current     REAL NOT NULL,
            premium_prior       REAL,
            status              TEXT NOT NULL CHECK(status IN ('active','pending','cancelled','expired','non_renewed')),
            multi_policy_discount INTEGER DEFAULT 0,
            created_at          TEXT NOT NULL,
            updated_at          TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS policy_coverages (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            policy_id   TEXT NOT NULL REFERENCES policies(policy_id),
            type        TEXT NOT NULL,
            "limit"     TEXT,
            deductible  REAL
        );

        CREATE TABLE IF NOT EXISTS communications (
            message_id      TEXT PRIMARY KEY,
            client_id       TEXT NOT NULL REFERENCES clients(id),
            direction       TEXT NOT NULL CHECK(direction IN ('inbound','outbound')),
            channel         TEXT NOT NULL CHECK(channel IN ('email','sms','phone','whatsapp')),
            subject         TEXT,
            body            TEXT,
            "from"          TEXT,
            "to"            TEXT,
            call_id         TEXT,
            duration_seconds INTEGER,
            transcript      TEXT,
            sentiment       TEXT CHECK(sentiment IN ('positive','neutral','negative')),
            timestamp       TEXT NOT NULL,
            read            INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS communication_topics (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            message_id      TEXT NOT NULL REFERENCES communications(message_id),
            topic           TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS quotes (
            request_id      TEXT PRIMARY KEY,
            client_id       TEXT NOT NULL REFERENCES clients(id),
            policy_type     TEXT NOT NULL,
            submitted_at    TEXT NOT NULL,
            status          TEXT NOT NULL,
            expires_at      TEXT,
            request_data    TEXT NOT NULL  -- Full JSON of drivers/vehicles/coverages
        );

        CREATE TABLE IF NOT EXISTS quote_results (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            request_id      TEXT NOT NULL REFERENCES quotes(request_id),
            quote_id        TEXT,
            carrier_code    TEXT NOT NULL,
            carrier_name    TEXT NOT NULL,
            premium_annual  REAL,
            premium_monthly REAL,
            status          TEXT NOT NULL,
            decline_reason  TEXT,
            valid_until     TEXT,
            coverages_json  TEXT,
            deductibles_json TEXT
        );

        CREATE TABLE IF NOT EXISTS documents (
            document_id     TEXT PRIMARY KEY,
            client_id       TEXT NOT NULL REFERENCES clients(id),
            document_type   TEXT NOT NULL CHECK(document_type IN (
                'signed_application','id_verification','coi','dec_page',
                'endorsement','cancellation_notice','welcome_kit'
            )),
            filename        TEXT NOT NULL,
            mime_type       TEXT NOT NULL,
            file_size_bytes INTEGER DEFAULT 0,
            status          TEXT NOT NULL CHECK(status IN ('uploaded','pending_signature','signed','expired')),
            upload_date     TEXT NOT NULL,
            signer_name     TEXT,
            signer_email    TEXT,
            signed_date     TEXT,
            expiration_date TEXT,
            audit_flag      TEXT,
            audit_note      TEXT
        );

        CREATE TABLE IF NOT EXISTS document_tags (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            document_id TEXT NOT NULL REFERENCES documents(document_id),
            tag         TEXT NOT NULL
        );
    """)


def create_views(conn: sqlite3.Connection) -> None:
    conn.executescript("""
        -- Policies expiring in next 90 days with rate change percentage
        CREATE VIEW IF NOT EXISTS v_renewal_pipeline AS
        SELECT
            p.policy_id,
            p.client_id,
            c.first_name || ' ' || c.last_name AS client_name,
            c.email,
            c.phone,
            p.carrier_code,
            p.policy_type,
            p.effective_date,
            p.expiration_date,
            p.premium_current,
            p.premium_prior,
            CASE
                WHEN p.premium_prior IS NOT NULL AND p.premium_prior > 0
                THEN ROUND((p.premium_current - p.premium_prior) / p.premium_prior * 100, 1)
                ELSE NULL
            END AS rate_change_pct,
            p.status
        FROM policies p
        JOIN clients c ON p.client_id = c.id
        WHERE p.status IN ('active', 'pending')
          AND p.expiration_date BETWEEN date('now') AND date('now', '+90 days')
        ORDER BY p.expiration_date ASC;

        -- Clients with coverage gaps (auto without home, home without umbrella)
        CREATE VIEW IF NOT EXISTS v_cross_sell_opportunities AS
        SELECT
            c.id AS client_id,
            c.first_name || ' ' || c.last_name AS client_name,
            c.email,
            c.phone,
            c.household_id,
            GROUP_CONCAT(DISTINCT p.policy_type) AS current_policy_types,
            CASE
                WHEN SUM(CASE WHEN p.policy_type = 'personal_auto' THEN 1 ELSE 0 END) > 0
                 AND SUM(CASE WHEN p.policy_type = 'homeowners' THEN 1 ELSE 0 END) = 0
                THEN 'Missing homeowners'
                ELSE NULL
            END AS auto_no_home,
            CASE
                WHEN SUM(CASE WHEN p.policy_type = 'homeowners' THEN 1 ELSE 0 END) > 0
                 AND SUM(CASE WHEN p.policy_type = 'umbrella' THEN 1 ELSE 0 END) = 0
                THEN 'Missing umbrella'
                ELSE NULL
            END AS home_no_umbrella,
            CASE
                WHEN SUM(CASE WHEN p.policy_type IN ('bop','general_liability','workers_comp') THEN 1 ELSE 0 END) > 0
                 AND SUM(CASE WHEN p.policy_type = 'umbrella' THEN 1 ELSE 0 END) = 0
                THEN 'Commercial without umbrella'
                ELSE NULL
            END AS commercial_no_umbrella
        FROM clients c
        JOIN policies p ON c.id = p.client_id AND p.status = 'active'
        GROUP BY c.id
        HAVING auto_no_home IS NOT NULL
            OR home_no_umbrella IS NOT NULL
            OR commercial_no_umbrella IS NOT NULL;

        -- Clients with low engagement + rate increase (retention risk)
        CREATE VIEW IF NOT EXISTS v_retention_risk AS
        SELECT
            c.id AS client_id,
            c.first_name || ' ' || c.last_name AS client_name,
            c.email,
            c.phone,
            c.engagement_score,
            c.last_email_open,
            MAX(ROUND((p.premium_current - p.premium_prior) / p.premium_prior * 100, 1)) AS max_rate_increase_pct,
            COUNT(DISTINCT p.policy_id) AS policy_count,
            MIN(p.expiration_date) AS next_expiration
        FROM clients c
        JOIN policies p ON c.id = p.client_id AND p.status IN ('active', 'pending')
        WHERE p.premium_prior IS NOT NULL AND p.premium_prior > 0
        GROUP BY c.id
        HAVING max_rate_increase_pct > 10
            OR c.engagement_score IS NOT NULL AND c.engagement_score < 30
        ORDER BY max_rate_increase_pct DESC;

        -- Clients missing required documents
        CREATE VIEW IF NOT EXISTS v_compliance_gaps AS
        SELECT
            d.document_id,
            d.client_id,
            c.first_name || ' ' || c.last_name AS client_name,
            c.email,
            d.document_type,
            d.status AS document_status,
            d.audit_flag,
            d.audit_note,
            d.upload_date
        FROM documents d
        JOIN clients c ON d.client_id = c.id
        WHERE d.audit_flag IS NOT NULL
           OR d.status = 'expired'
           OR d.status = 'pending_signature'
        ORDER BY d.client_id;
    """)


def load_clients(conn: sqlite3.Connection, data: list) -> None:
    for client in data:
        addr = client.get("address", {})
        conn.execute("""
            INSERT OR REPLACE INTO clients (
                id, first_name, last_name, dob, email, phone,
                address_street, address_city, address_state, address_zip,
                driver_license_number, occupation, marital_status,
                household_id, preferred_contact_method, preferred_contact_time,
                status, engagement_score, last_email_open, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            client["id"], client["first_name"], client["last_name"],
            client["dob"], client["email"], client["phone"],
            addr.get("street"), addr.get("city"), addr.get("state"), addr.get("zip"),
            client.get("driver_license_number"), client.get("occupation"),
            client.get("marital_status"), client.get("household_id"),
            client.get("preferred_contact_method"), client.get("preferred_contact_time"),
            client.get("status", "active"),
            client.get("engagement_score"), client.get("last_email_open"),
            client["created_at"], client["updated_at"],
        ))
        for accident in client.get("accidents", []):
            conn.execute("""
                INSERT INTO client_accidents (client_id, date, type, description)
                VALUES (?, ?, ?, ?)
            """, (client["id"], accident["date"], accident["type"], accident.get("description")))


def load_policies(conn: sqlite3.Connection, data: list) -> None:
    for policy in data:
        conn.execute("""
            INSERT OR REPLACE INTO policies (
                policy_id, client_id, carrier_code, policy_type,
                effective_date, expiration_date, premium_current, premium_prior,
                status, multi_policy_discount, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            policy["policy_id"], policy["client_id"], policy["carrier_code"],
            policy["policy_type"], policy["effective_date"], policy["expiration_date"],
            policy["premium_current"], policy.get("premium_prior"),
            policy["status"], 1 if policy.get("multi_policy_discount") else 0,
            policy["created_at"], policy["updated_at"],
        ))
        for cov in policy.get("coverages", []):
            conn.execute("""
                INSERT INTO policy_coverages (policy_id, type, "limit", deductible)
                VALUES (?, ?, ?, ?)
            """, (policy["policy_id"], cov["type"], cov.get("limit"), cov.get("deductible")))


def load_communications(conn: sqlite3.Connection, data: list) -> None:
    for msg in data:
        conn.execute("""
            INSERT OR REPLACE INTO communications (
                message_id, client_id, direction, channel, subject, body,
                "from", "to", call_id, duration_seconds, transcript, sentiment,
                timestamp, read
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            msg["message_id"], msg["client_id"], msg["direction"], msg["channel"],
            msg.get("subject"), msg.get("body"), msg.get("from"), msg.get("to"),
            msg.get("call_id"), msg.get("duration_seconds"), msg.get("transcript"),
            msg.get("sentiment"), msg["timestamp"],
            1 if msg.get("read") else 0,
        ))
        for topic in msg.get("topics", []):
            conn.execute("""
                INSERT INTO communication_topics (message_id, topic) VALUES (?, ?)
            """, (msg["message_id"], topic))


def load_quotes(conn: sqlite3.Connection, data: list) -> None:
    for quote in data:
        request_data = json.dumps({
            k: v for k, v in quote.items()
            if k not in ("request_id", "client_id", "policy_type", "submitted_at", "status", "expires_at", "results")
        })
        conn.execute("""
            INSERT OR REPLACE INTO quotes (
                request_id, client_id, policy_type, submitted_at, status, expires_at, request_data
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (
            quote["request_id"], quote["client_id"], quote["policy_type"],
            quote["submitted_at"], quote["status"], quote.get("expires_at"),
            request_data,
        ))
        for result in quote.get("results", []):
            conn.execute("""
                INSERT INTO quote_results (
                    request_id, quote_id, carrier_code, carrier_name,
                    premium_annual, premium_monthly, status, decline_reason,
                    valid_until, coverages_json, deductibles_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                quote["request_id"], result.get("quote_id"),
                result["carrier_code"], result["carrier_name"],
                result.get("premium_annual"), result.get("premium_monthly"),
                result["status"], result.get("decline_reason"),
                result.get("valid_until"),
                json.dumps(result.get("coverages", [])),
                json.dumps(result.get("deductibles", {})),
            ))


def load_documents(conn: sqlite3.Connection, data: list) -> None:
    for doc in data:
        conn.execute("""
            INSERT OR REPLACE INTO documents (
                document_id, client_id, document_type, filename, mime_type,
                file_size_bytes, status, upload_date, signer_name, signer_email,
                signed_date, expiration_date, audit_flag, audit_note
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            doc["document_id"], doc["client_id"], doc["document_type"],
            doc["filename"], doc["mime_type"], doc.get("file_size_bytes", 0),
            doc["status"], doc["upload_date"],
            doc.get("signer_name"), doc.get("signer_email"),
            doc.get("signed_date"), doc.get("expiration_date"),
            doc.get("audit_flag"), doc.get("audit_note"),
        ))
        for tag in doc.get("tags", []):
            conn.execute("""
                INSERT INTO document_tags (document_id, tag) VALUES (?, ?)
            """, (doc["document_id"], tag))


def main() -> None:
    # Remove existing DB
    if DB_PATH.exists():
        DB_PATH.unlink()
        print(f"Removed existing {DB_PATH}")

    # Verify all JSON files exist
    for name, path in JSON_FILES.items():
        if not path.exists():
            print(f"ERROR: Missing {path}", file=sys.stderr)
            sys.exit(1)

    # Load JSON data
    data = {}
    for name, path in JSON_FILES.items():
        with open(path) as f:
            data[name] = json.load(f)
        print(f"Loaded {len(data[name])} {name} from {path.name}")

    # Create database
    conn = sqlite3.connect(str(DB_PATH))
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")

    try:
        create_schema(conn)
        print("Schema created.")

        load_clients(conn, data["clients"])
        print(f"Loaded {len(data['clients'])} clients + accidents.")

        load_policies(conn, data["policies"])
        print(f"Loaded {len(data['policies'])} policies + coverages.")

        load_communications(conn, data["communications"])
        print(f"Loaded {len(data['communications'])} communications + topics.")

        load_quotes(conn, data["quotes"])
        print(f"Loaded {len(data['quotes'])} quotes + results.")

        load_documents(conn, data["documents"])
        print(f"Loaded {len(data['documents'])} documents + tags.")

        create_views(conn)
        print("Views created.")

        conn.commit()

        # Verify
        print("\n--- Verification ---")
        tables = ["clients", "policies", "communications", "quotes", "documents",
                   "client_accidents", "policy_coverages", "communication_topics",
                   "quote_results", "document_tags"]
        for table in tables:
            count = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            print(f"  {table}: {count} rows")

        print("\n--- View Previews ---")
        views = ["v_renewal_pipeline", "v_cross_sell_opportunities",
                 "v_retention_risk", "v_compliance_gaps"]
        for view in views:
            count = conn.execute(f"SELECT COUNT(*) FROM {view}").fetchone()[0]
            print(f"  {view}: {count} rows")

        # Foreign key integrity check
        violations = conn.execute("PRAGMA foreign_key_check").fetchall()
        if violations:
            print(f"\nWARNING: {len(violations)} foreign key violations found!")
            for v in violations:
                print(f"  Table: {v[0]}, rowid: {v[1]}, parent: {v[2]}, fkid: {v[3]}")
        else:
            print("\nForeign key integrity: PASSED")

        print(f"\nDatabase created at: {DB_PATH}")
        print(f"Database size: {DB_PATH.stat().st_size / 1024:.1f} KB")

    finally:
        conn.close()


if __name__ == "__main__":
    main()
