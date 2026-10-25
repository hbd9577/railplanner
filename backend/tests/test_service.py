"""Service, demand and benefit-cost model: calibration data, behavior and API."""
import logging

import pytest
from fastapi.testclient import TestClient

from app import planner, service
from app.main import app


@pytest.fixture(scope="module")
def plan():
    logging.disable(logging.WARNING)
    ids = {c.name: c.id for c in planner.list_cities()}
    p = planner.run_plan(ids["Albany"], ids["Buffalo"], runs=1000, persist=False)
    logging.disable(logging.NOTSET)
    return p


def test_observed_network_matches_fy2024_frequencies():
    pairs = {(p["a"], p["b"]): p for p in service.observed_pairs()}
    assert pairs[("Albany", "New York City")]["freq"] == 13
    assert pairs[("Albany", "Buffalo")]["freq"] == 4
    assert pairs[("Chicago", "Cleveland")]["freq"] == 2


def test_calibration_is_documented_and_bounded():
    cal = service.calibration()
    assert cal["scale"] > 0 and 0 <= cal["time_ratio_exponent"] <= 4
    assert cal["loo_rms_log_error"] >= cal["rms_log_error"]
    assert cal["loo_rms_log_error"] < 0.8  # worse than this and the model is not worth showing
    assert len(cal["stations"]) == len(service.observed()["station_ridership"])


def test_every_parameter_has_a_basis():
    for name, p in service.load_parameters()["params"].items():
        assert p["basis"] in {"verified", "derived", "assumption"}, name
        if p["basis"] == "verified":
            assert p.get("source"), name


def test_service_results_are_consistent(plan):
    for r in plan.routes:
        s = r.service
        assert s and s.available
        for rng in (s.riders, s.revenue, s.opex, s.bcr, s.co2_tonnes):
            assert rng.p10 <= rng.p50 <= rng.p90
        assert s.end_to_end_min > 0 and s.trainsets >= 2
        assert s.load_factor <= service.P("max_load_factor") + 1e-6
        shares = s.public_share + s.freight_share + s.inactive_share + s.off_rail_share
        assert shares == pytest.approx(1.0)
        assert len(s.pairs) == s.stations * (s.stations - 1) // 2


def test_more_trains_more_riders_and_cost(plan):
    r = plan.routes[0]
    low = service.evaluate(r, service.ServiceParams(round_trips=4))
    high = service.evaluate(r, service.ServiceParams(round_trips=12))
    assert high.riders.p50 > low.riders.p50
    assert high.opex.p50 > low.opex.p50
    assert high.trainsets >= low.trainsets


def test_faster_trains_shorter_trips(plan):
    r = plan.routes[0]
    slow = service.evaluate(r, service.ServiceParams(max_mph_existing=79))
    fast = service.evaluate(r, service.ServiceParams(max_mph_existing=110))
    assert fast.end_to_end_min < slow.end_to_end_min
    assert fast.riders.p50 >= slow.riders.p50


def test_service_endpoint_validates_and_recomputes(plan):
    with TestClient(app) as client:
        body = {"origin_id": plan.origin.id, "dest_id": plan.destination.id, "round_trips": 6}
        res = client.post("/service", json=body)
        assert res.status_code == 200
        routes = res.json()["routes"]
        assert len(routes) == len(plan.routes) and all(x["round_trips"] == 6 for x in routes)
        assert client.post("/service", json={**body, "round_trips": 0}).status_code == 400
        params = client.get("/service-parameters").json()
        assert "calibration" in params and "fare_per_pmi" in params["parameters"]["params"]
