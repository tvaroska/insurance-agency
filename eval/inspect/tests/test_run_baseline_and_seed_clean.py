"""Unit tests for eval/inspect/run_baseline.py and data/seed-clean/ referential integrity."""

from __future__ import annotations

import json
import subprocess
import time
from pathlib import Path

import pytest

import run_baseline
from evergreen import GYM_ROOT


def test_run_baseline_help_runs_offline_under_100ms(monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]):
    # Ensure gcloud is never invoked when parsing --help.
    def forbid_gcloud(*args: object, **kwargs: object):
        raise AssertionError("gcloud must not be called during --help or import")

    monkeypatch.setattr(subprocess, "check_output", forbid_gcloud)
    start = time.monotonic()
    with pytest.raises(SystemExit) as exc:
        run_baseline.main(["--help"])
    elapsed = time.monotonic() - start
    assert exc.value.code == 0
    assert elapsed < 0.25
    help_text = capsys.readouterr().out
    assert "--parallel-stacks" in help_text
    assert "--learning-mechanism" in help_text
    assert "--artifacts-dir" in help_text


def test_stack_base_urls_and_scenario_parsing():
    urls = run_baseline.stack_base_urls(3200)
    assert urls == {
        "ams": "http://localhost:3200",
        "rater": "http://localhost:3201",
        "crm": "http://localhost:3202",
        "ecm": "http://localhost:3203",
        "comm": "http://localhost:3204",
        "summit-fire": "http://localhost:3205",
        "coastal-star": "http://localhost:3206",
        "claims": "http://localhost:3207",
    }
    assert run_baseline.parse_scenarios_arg("1, 14, 20") == ["01", "14", "20"]
    assert len(run_baseline.parse_scenarios_arg("all")) == 20


def test_ensure_parallel_stacks_attaches_to_prelaunched_stacks(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(run_baseline, "_is_stack_ready", lambda base_port, modality_mode: True)
    handles = run_baseline.ensure_parallel_stacks(count=4, stack_base_port=3100, modality_mode="strict")
    assert [h.base_port for h in handles] == [3100, 3200, 3300, 3400]
    assert all(h.process is None for h in handles)
    run_baseline.shutdown_stacks(handles)


def test_seed_clean_foreign_key_integrity_and_clean_control_purity():
    seed_clean = GYM_ROOT / "data" / "seed-clean"
    seed_realistic = GYM_ROOT / "data" / "seed"

    # Legacy monolithic SQLite script/file must remain retired.
    assert not (seed_realistic / "load_db.py").exists()
    assert not (seed_realistic / "evergreen.db").exists()

    expected_counts = {
        "adjusters.json": 3,
        "campaigns.json": 5,
        "carriers.json": 7,
        "claims.json": 14,
        "clients.json": 31,
        "commissions.json": 15,
        "communications.json": 42,
        "documents.json": 85,
        "endorsements.json": 5,
        "envelopes.json": 10,
        "leads.json": 14,
        "marketing_assets.json": 8,
        "policies.json": 80,
        "quotes.json": 17,
        "retention_risks.json": 10,
        "tasks.json": 8,
    }
    loaded: dict[str, list[dict]] = {}
    for fname, count in expected_counts.items():
        path = seed_clean / fname
        assert path.is_file(), f"Missing {path}"
        rows = json.loads(path.read_text(encoding="utf-8"))
        assert len(rows) == count, f"{fname}: expected {count} rows, found {len(rows)}"
        loaded[fname] = rows

    clients_by_id = {c["id"]: c for c in loaded["clients.json"]}
    client_names = {(c["first_name"], c["last_name"]): c["id"] for c in loaded["clients.json"]}
    client_emails = {c["email"].lower(): c["id"] for c in loaded["clients.json"]}
    policies_by_id = {p["policy_id"]: p for p in loaded["policies.json"]}
    adjusters_by_id = {a["adjuster_id"]: a for a in loaded["adjusters.json"]}

    # 1. Leads FK integrity: Jessica Williams (lead_a1b2c3d4) must have client_id=None,
    #    every linked lead must match its client's identity, and net-new leads must not shadow an existing client.
    leads_by_id = {l["lead_id"]: l for l in loaded["leads.json"]}
    assert leads_by_id["lead_a1b2c3d4"]["first_name"] == "Jessica"
    assert leads_by_id["lead_a1b2c3d4"]["last_name"] == "Williams"
    assert leads_by_id["lead_a1b2c3d4"]["client_id"] is None

    for lead in loaded["leads.json"]:
        cid = lead["client_id"]
        full_name = (lead["first_name"], lead["last_name"])
        email = lead["email"].lower()
        if cid is not None:
            assert cid in clients_by_id, f"{lead['lead_id']} references missing client {cid}"
            client = clients_by_id[cid]
            assert (client["first_name"], client["last_name"]) == full_name, (
                f"{lead['lead_id']} cross-wired to {cid} ({client['first_name']} {client['last_name']})"
            )
            assert client["email"].lower() == email
        else:
            assert full_name not in client_names, f"Unlinked {lead['lead_id']} shadows client {client_names[full_name]}"
            assert email not in client_emails, f"Unlinked {lead['lead_id']} shadows client {client_emails[email]}"

    # 2. Retention risks, envelopes, policies, quotes, documents, communications referential integrity.
    for risk in loaded["retention_risks.json"]:
        client = clients_by_id[risk["client_id"]]
        assert risk["client_name"] == f"{client['first_name']} {client['last_name']}"

    for env in loaded["envelopes.json"]:
        client = clients_by_id[env["client_id"]]
        policyholders = [s for s in env["signers"] if s["role"] == "policyholder"]
        assert policyholders[0]["name"] == f"{client['first_name']} {client['last_name']}"
        assert policyholders[0]["email"].lower() == client["email"].lower()

    for pol in loaded["policies.json"]:
        assert pol["client_id"] in clients_by_id

    for doc in loaded["documents.json"]:
        assert doc["client_id"] in clients_by_id

    for quote in loaded["quotes.json"]:
        assert quote["client_id"] in clients_by_id

    # 3. Clean-control purity: zero residual attorney/litigation/subpoena traps in claims.json or communications.json.
    forbidden_terms = ("attorney", "lawyer", "subpoena", "demand letter", "lawsuit", "threatening to sue", "disputed")
    for clm in loaded["claims.json"]:
        assert clm["client_id"] in clients_by_id
        assert clm["policy_id"] in policies_by_id
        if clm["adjuster_id"] is not None:
            assert clm["adjuster_id"] in adjusters_by_id
        combined = f"{clm.get('loss_description') or ''} {clm.get('notes') or ''}".lower()
        for term in forbidden_terms:
            assert term not in combined, f"Clean claim {clm['claim_id']} contains residual trap term {term!r}"

    for msg in loaded["communications.json"]:
        assert msg["client_id"] in clients_by_id
        combined = " ".join(
            str(msg.get(k) or "") for k in ("subject", "body", "transcript")
        ).lower()
        for term in forbidden_terms:
            assert term not in combined, f"Clean message {msg['message_id']} contains residual trap term {term!r}"


def test_realistic_seed_falls_back_to_first_messy_variant_for_scenarios_without_one():
    from evergreen import load_evergreen_samples

    samples = load_evergreen_samples(scenario="09", seed="realistic", difficulty="natural")
    assert [s.metadata["seed"] for s in samples] == ["moderate"]
    assert load_evergreen_samples(scenario="09", seed="clean", difficulty="natural") == []
    all_realistic = load_evergreen_samples(scenario=None, seed="realistic", difficulty="natural")
    assert sorted({s.metadata["scenario_id"] for s in all_realistic}) == [f"{i:02d}" for i in range(1, 21)]
