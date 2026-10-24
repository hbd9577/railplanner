"""Proposal/Q&A: number check, Gemini retry and fallback (Gemini mocked), endpoints."""
import json

import pytest
from fastapi.testclient import TestClient

from app import planner, proposal
from app.main import app
from app.planner import list_cities, load_demo_cache


@pytest.fixture(scope="module")
def plan():
    ids = {c.name: c for c in list_cities()}
    return load_demo_cache(ids["Albany"], ids["Buffalo"])


@pytest.fixture(scope="module")
def payload(plan):
    return proposal.build_payload(plan)


def _sections(text: str) -> str:
    return json.dumps({k: text for k in ["title", "executive_summary", "corridor_description", "cost_and_schedule",
                                         "funding_strategy", "risks", "next_steps"]})


def test_number_check_accepts_payload_figures(payload):
    c = payload["alternatives"][0]["capital_cost"]["median_P50"]
    assert proposal.number_check(f"The median cost is {c}.", payload)["passed"]


def test_number_check_flags_invented_figures(payload):
    res = proposal.number_check("Ridership would reach 4,321,987 trips and save $9.87B.", payload)
    assert not res["passed"]
    assert "4,321,987" in res["unmatched"] and "$9.87B" in res["unmatched"]


def test_number_check_ignores_list_markers(payload):
    assert proposal.number_check("1. First step\n2. Second step\n", payload)["passed"]


def test_template_proposal_passes_and_has_sections(payload):
    md = proposal.template_proposal(payload)
    assert proposal.number_check(md, payload)["passed"]
    for _, heading in proposal.SECTIONS:
        assert f"## {heading}" in md
    assert "Illustrative estimates" in md


def test_generate_retries_then_passes(plan, payload, monkeypatch):
    good = payload["alternatives"][0]["capital_cost"]["median_P50"]
    replies = iter([_sections("It costs $123.4B."), _sections(f"It costs {good}.")])
    calls = []

    def fake(contents, system, schema=None, temperature=0.3):
        calls.append(contents)
        return next(replies)

    monkeypatch.setattr(proposal, "_generate", fake)
    res = proposal.generate_proposal(plan)
    assert res["source"] == "gemini" and res["number_check"]["passed"]
    assert len(calls) == 2 and "$123.4B" in calls[1]  # retry prompt names the bad figure
    assert "## Executive Summary" in res["markdown"] and "Illustrative estimates" in res["markdown"]


def test_generate_falls_back_to_template(plan, monkeypatch):
    def down(*a, **k):
        raise proposal.GeminiUnavailable("503")

    monkeypatch.setattr(proposal, "_generate", down)
    res = proposal.generate_proposal(plan)
    assert res["source"] == "template" and res["number_check"]["passed"]


def test_ask_retries_on_bad_numbers(plan, payload, monkeypatch):
    good = payload["alternatives"][1]["length"]
    replies = iter(["It is 9999 miles.", f"It is {good}."])
    monkeypatch.setattr(proposal, "_generate", lambda *a, **k: next(replies))
    res = proposal.ask("How long is alternative 2?", plan)
    assert res["number_check"]["passed"] and good in res["answer"]


def test_endpoints(plan, monkeypatch):
    # in-memory proposal store so the test never overwrites the real Tiger rows or demo JSON
    store = {}
    monkeypatch.setattr(planner, "save_proposal", lambda p, res: store.__setitem__(p.request_id, res))
    monkeypatch.setattr(planner, "load_proposal", lambda p: store.get(p.request_id))
    monkeypatch.setattr(proposal, "_generate", lambda *a, **k: _sections("A draft with no figures."))
    with TestClient(app) as client:
        r = client.post(f"/proposal/{plan.request_id}?refresh=true")
        assert r.status_code == 200 and r.json()["source"] == "gemini"
        r2 = client.post(f"/proposal/{plan.request_id}")
        assert r2.status_code == 200 and r2.json()["source"] == "cache"
        assert client.post("/proposal/999999").status_code == 404
        assert client.post(f"/ask/{plan.request_id}", json={"question": "  "}).status_code == 400

        def down(*a, **k):
            raise proposal.GeminiUnavailable("busy")

        monkeypatch.setattr(proposal, "_generate", down)
        assert client.post(f"/ask/{plan.request_id}", json={"question": "Why?"}).status_code == 503
