"""Unit and HTTP tests for the DB-state-first blind human audit workbench."""

from __future__ import annotations

import json
import threading
import urllib.request
from pathlib import Path

import blind_audit_workbench as wb
import score_blind_audit as sba
from evergreen import GYM_ROOT


def _opener() -> urllib.request.OpenerDirector:
    return urllib.request.build_opener(urllib.request.ProxyHandler({}))


def test_diff_snapshots_tracks_inserts_updates_deletes_and_separates_sim_replies():
    before = {
        "ams": {
            "clients": [
                {"id": "CLI-001", "first_name": "Sarah", "last_name": "Chen", "phone": "310-555-0101", "updated_at": "2026-02-18T00:00:00Z"},
                {"id": "CLI-002", "first_name": "James", "last_name": "Chen", "phone": "310-555-0102", "updated_at": "2026-02-18T00:00:00Z"},
            ],
            "policies": [
                {"policy_id": "POL-PA-2025-001848", "client_id": "CLI-002", "policy_type": "auto", "carrier_code": "SMIT"},
            ],
            "endorsements": [],
            "tasks": [{"id": "TSK-1", "title": "Old", "status": "open"}],
        },
        "comm": {"messages": []},
    }
    after = {
        "ams": {
            "clients": [
                # Pure updated_at change must be ignored
                {"id": "CLI-001", "first_name": "Sarah", "last_name": "Chen", "phone": "310-555-0101", "updated_at": "2026-02-18T00:05:00Z"},
                # Substantive phone update must be recorded
                {"id": "CLI-002", "first_name": "James", "last_name": "Chen", "phone": "310-555-0199", "updated_at": "2026-02-18T00:05:00Z"},
            ],
            "policies": before["ams"]["policies"],
            "endorsements": [
                {"endorsement_id": "END-1", "policy_id": "POL-PA-2025-001848", "change_type": "modify_coverage"},
            ],
            "tasks": [],
        },
        "comm": {
            "messages": [
                {"message_id": "msg_out_1", "client_id": "CLI-002", "direction": "outbound", "body": "Please confirm"},
                {"message_id": "msg_sim_1", "client_id": "CLI-002", "direction": "inbound", "body": "Use James's policy"},
            ]
        },
    }

    diff = wb.diff_snapshots(before, after)
    assert diff["summary"]["inserted_count"] == 2  # endorsement + outbound msg (sim reply excluded)
    assert diff["summary"]["updated_count"] == 1  # CLI-002 phone (CLI-001 timestamp-only ignored)
    assert diff["summary"]["deleted_count"] == 1  # TSK-1
    assert diff["summary"]["sim_reply_count"] == 1

    # Endorsement resolved policy_id -> CLI-002 James Chen
    ams_svc = next(s for s in diff["services"] if s["service"] == "ams")
    end_tbl = next(t for t in ams_svc["tables"] if t["table"] == "endorsements")
    assert end_tbl["inserted"][0]["client_id"] == "CLI-002"
    assert "James Chen" in end_tbl["inserted"][0]["client_name"]
    assert "auto" in end_tbl["inserted"][0]["policy_label"]

    cli_tbl = next(t for t in ams_svc["tables"] if t["table"] == "clients")
    assert len(cli_tbl["updated"]) == 1
    assert cli_tbl["updated"][0]["changed_fields"] == ["phone"]
    assert cli_tbl["updated"][0]["field_diffs"] == [
        {"field": "phone", "before": "310-555-0102", "after": "310-555-0199"}
    ]

    touched_ids = [c["client_id"] for c in diff["clients_touched"]]
    assert touched_ids == ["CLI-002"]


def test_save_verdict_round_trips_with_score_blind_audit(tmp_path: Path):
    sheet = tmp_path / "sheet.md"
    sheet.write_text(
        """# Blind Audit

## AUD-01 — Workflow 10 (`10-realistic-natural`)

- **Prompt:** Audit the book.
- **Agent Final Reply:** Audited everything.

- [ ] `PASS`
- [ ] `FAIL`
- **Rater Note:** 

---

## AUD-02 — Workflow 01 (`01-realistic-natural`)

- **Prompt:** Intake Sarah Chen.
- **Agent Final Reply:** Done.

- [ ] `PASS`
- [ ] `FAIL`
- **Rater Note:** 
""",
        encoding="utf-8",
    )

    wb.save_verdict_to_sheet(sheet, "AUD-01", passed=False, c1="N", c2="N", c3="Y", note="missed CLI-024 and tasks")
    wb.save_verdict_to_sheet(sheet, "AUD-02", passed=True, c1="Y", c2="NA", c3="Y", note="clean")

    parsed_scorer = sba.parse_blind_sheet(sheet.read_text(encoding="utf-8"))
    assert parsed_scorer["AUD-01"]["passed"] is False
    assert "[C1=N C2=N C3=Y]" in parsed_scorer["AUD-01"]["note"]
    assert "missed CLI-024" in parsed_scorer["AUD-01"]["note"]
    assert parsed_scorer["AUD-02"]["passed"] is True

    parsed_wb = wb.parse_sheet_state(sheet.read_text(encoding="utf-8"))
    assert parsed_wb["AUD-01"]["c1"] == "N"
    assert parsed_wb["AUD-01"]["c2"] == "N"
    assert parsed_wb["AUD-01"]["c3"] == "Y"
    assert parsed_wb["AUD-01"]["note"] == "missed CLI-024 and tasks"

    # Clearing resets back to unmarked
    wb.save_verdict_to_sheet(sheet, "AUD-01", passed=None, c1=None, c2=None, c3=None, note="")
    parsed_after = sba.parse_blind_sheet(sheet.read_text(encoding="utf-8"))
    assert parsed_after["AUD-01"]["passed"] is None
    assert parsed_after["AUD-01"]["note"] == ""


def test_http_server_is_strictly_blind_and_persists_verdicts(tmp_path: Path):
    sheet = tmp_path / "sheet.md"
    key = tmp_path / "key.json"
    art = tmp_path / "artifacts" / "trial-1"
    art.mkdir(parents=True)
    (art / "snapshot-before.json").write_text(json.dumps({"ams": {"tasks": []}}), encoding="utf-8")
    (art / "snapshot-after.json").write_text(
        json.dumps({"ams": {"tasks": [{"id": "TSK-99", "client_id": "CLI-004", "title": "Follow up"}]}}),
        encoding="utf-8",
    )
    sheet.write_text(
        """# Sample

## AUD-01 — Workflow 11 (`11-realistic-natural`)

- **Prompt:** Prep Thompson meeting.
- **Agent Final Reply:** Brief ready.

- [ ] `PASS`
- [ ] `FAIL`
- **Rater Note:** 
""",
        encoding="utf-8",
    )
    key.write_text(
        json.dumps(
            {
                "schema_version": "1.0",
                "total_items": 1,
                "items": [
                    {
                        "audit_id": "AUD-01",
                        "scenario_id": "11",
                        "sample_id": "11-realistic-natural",
                        "epoch": 1,
                        "arm": "claude-sonnet-5-5",
                        "model": "anthropic/vertex/claude-sonnet-5-5",
                        "learning_mechanism": "Domain skill (SOP)",
                        "eval_file": "",
                        "artifacts_dir": "artifacts/trial-1",
                        "grader_passed": False,
                        "grader_score": 0.42,
                        "eo_compliant": False,
                        "collateral_penalty": 0.2,
                        "taxonomy": "T2_JUDGMENT_EO_TRAP_MISSED",
                    }
                ],
            }
        ),
        encoding="utf-8",
    )

    store = wb.BlindAuditStore(sheet_path=sheet, key_path=key, gym_root=tmp_path)
    server = wb.create_server(store, host="127.0.0.1", port=0)
    port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    opener = _opener()
    try:
        items_raw = opener.open(f"http://127.0.0.1:{port}/api/items").read().decode("utf-8")
        detail_raw = opener.open(f"http://127.0.0.1:{port}/api/item/AUD-01").read().decode("utf-8")
        html_raw = opener.open(f"http://127.0.0.1:{port}/").read().decode("utf-8")
        assert "Evergreen Blind Audit" in html_raw

        for payload in (items_raw, detail_raw):
            for forbidden in wb.FORBIDDEN_BLIND_TOKENS:
                assert forbidden not in payload, f"Blinded payload leaked {forbidden!r}"

        detail = json.loads(detail_raw)
        assert detail["has_snapshots"] is True
        assert detail["db_diff"]["summary"]["inserted_count"] == 1

        req = urllib.request.Request(
            f"http://127.0.0.1:{port}/api/verdict",
            data=json.dumps(
                {"audit_id": "AUD-01", "passed": True, "c1": "Y", "c2": "Y", "c3": "Y", "note": "verified"}
            ).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        post_res = json.loads(opener.open(req).read().decode("utf-8"))
        assert post_res["progress"]["marked"] == 1
        assert post_res["progress"]["pass_count"] == 1
    finally:
        server.shutdown()
        server.server_close()


def test_real_v08_store_index_is_strictly_blind():
    store = wb.BlindAuditStore(
        sheet_path=GYM_ROOT / "eval" / "results" / "v0.8" / "blind-audit-60-sheet.md",
        key_path=GYM_ROOT / "eval" / "results" / "v0.8" / "blind-audit-60-key.json",
        gym_root=GYM_ROOT,
    )
    items_payload = json.dumps(store.list_items())
    assert json.loads(items_payload)["total"] == 60
    for forbidden in wb.FORBIDDEN_BLIND_TOKENS:
        assert forbidden not in items_payload, f"Real v0.8 index leaked {forbidden!r}"
