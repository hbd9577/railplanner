import time

import pytest
from fastapi.testclient import TestClient

from app import db
from app.config import get_settings
from app.main import app

needs_db = pytest.mark.skipif(not get_settings().database_url, reason="DATABASE_URL not set")


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="module")
def ids(client):
    return {c["name"]: c["id"] for c in client.get("/cities").json()}


def test_cities(client, ids):
    assert len(ids) == 17 and {"Albany", "Chicago"} <= set(ids)


def test_demo_pairs(client):
    pairs = client.get("/demo-pairs").json()
    assert len(pairs) == 4
    assert pairs[0]["label"].startswith("New York City")


def test_plan_validation(client, ids):
    assert client.post("/plan", json={"origin_id": ids["Albany"], "dest_id": ids["Albany"]}).status_code == 400
    assert client.post("/plan", json={"origin_id": 9999, "dest_id": ids["Albany"]}).status_code == 404
    assert client.get("/plan/999999").status_code in (404,)


@needs_db
def test_demo_plan_served_from_tiger(client, ids):
    t0 = time.perf_counter()
    r = client.post("/plan", json={"origin_id": ids["Albany"], "dest_id": ids["Buffalo"]})
    assert r.status_code == 200
    assert time.perf_counter() - t0 < 3
    plan = r.json()
    assert plan["cached"] is True and plan["request_id"]
    assert len(plan["routes"]) == 3
    for route in plan["routes"]:
        sim = route["simulation"]
        assert sim["source"] == "tiger_cagg" and sim["runs"] >= 1000
        assert sim["cost"]["p10"] < sim["cost"]["p50"] < sim["cost"]["p90"]
        assert len(sim["cost"]["histogram"]) > 5 and len(sim["duration"]["histogram"]) > 5
        assert route["geometry"]["type"] == "LineString"
        assert sum(m["eligible"] and m["fit_score"] > 0.3 for m in route["funding"]) >= 3
    again = client.get(f"/plan/{plan['request_id']}").json()
    assert [r["simulation"]["cost"]["p50"] for r in again["routes"]] == \
           [r["simulation"]["cost"]["p50"] for r in plan["routes"]]


def test_db_down_falls_back(client, ids, monkeypatch):
    """With the DB unreachable, demo pairs come from the JSON cache and others compute locally."""
    monkeypatch.setattr(db, "_down_until", time.monotonic() + 600)

    cities = client.get("/cities").json()
    assert len(cities) == 17

    r = client.post("/plan", json={"origin_id": ids["Albany"], "dest_id": ids["Buffalo"]})
    assert r.status_code == 200
    plan = r.json()
    assert plan["cached"] is True and len(plan["routes"]) == 3
    assert client.get(f"/plan/{plan['request_id']}").status_code == 200

    t0 = time.perf_counter()
    r = client.post("/plan", json={"origin_id": ids["Utica"], "dest_id": ids["Binghamton"]})
    assert r.status_code == 200
    assert time.perf_counter() - t0 < 10  # no waiting on DB timeouts
    plan = r.json()
    assert plan["request_id"] is None
    assert {rt["simulation"]["source"] for rt in plan["routes"]} == {"local"}


def test_voice_not_configured_yet(client):
    assert client.post("/voice", json={"text": "hi"}).status_code == 503
