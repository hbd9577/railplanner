"""Shape/range sanity for scoring, simulation and funding, plus a DB round trip (skipped without a DB)."""
import numpy as np
import pytest

from app.config import get_settings
from app.funding import match_route
from app.routing import generate_candidates, load_cities
from app.scoring import SCORE_WEIGHTS, route_metrics, score_routes
from app.simulation import load_benchmarks, pert, run_simulation, summarize_local

CITIES = {c["name"]: (c["lon"], c["lat"]) for c in load_cities()}


@pytest.fixture(scope="module")
def scored():
    cands = generate_candidates(CITIES["Albany"], CITIES["Buffalo"])
    return cands, score_routes([route_metrics(c) for c in cands])


# ---------------------------------------------------------------- scoring

def test_score_weights_sum_to_one():
    assert sum(SCORE_WEIGHTS.values()) == pytest.approx(1.0)


def test_route_stats_ranges(scored):
    cands, stats = scored
    for c, s in zip(cands, stats):
        assert 0 <= s.score <= 100
        assert all(0 <= v <= 1 for v in s.score_breakdown.components.values())
        assert 0 <= s.row_reuse_pct <= 100
        assert 1e6 < s.population_served < 6e6  # Albany-Buffalo corridor, 10 mi buffer
        assert sum(seg.miles for seg in s.segments) == pytest.approx(s.length_miles, rel=0.01)
        assert {"Albany", "Buffalo"} <= set(s.stations)
        assert s.river_crossings_new <= s.river_crossings


def test_strategies_win_their_own_metric(scored):
    _, stats = scored
    by_key = dict(zip(["row", "direct", "population"], stats))
    assert by_key["row"].row_reuse_pct == max(s.row_reuse_pct for s in stats)
    assert by_key["direct"].length_miles == min(s.length_miles for s in stats)
    assert by_key["population"].population_served == max(s.population_served for s in stats)


# ---------------------------------------------------------------- simulation

def test_pert_stays_in_bounds():
    x = pert(np.random.default_rng(0), 10, 20, 50, 10_000)
    assert x.min() >= 10 and x.max() <= 50
    assert 18 < np.median(x) < 26


def test_benchmarks_ordered():
    for key, (lo, mode, hi) in load_benchmarks().items():
        assert lo <= mode <= hi, key


def test_simulation_shapes_and_percentiles(scored):
    cands, stats = scored
    for c, s in zip(cands, stats):
        cost, dur = run_simulation(c.key, s, 2000)
        assert cost.shape == dur.shape == (2000,)
        assert (cost > 0).all() and (dur > 0).all()
        summ = summarize_local(cost, dur)
        assert summ.cost.p10 < summ.cost.p50 < summ.cost.p90
        assert summ.duration.p10 < summ.duration.p50 < summ.duration.p90
        assert summ.cost.p50 == pytest.approx(np.median(cost), rel=0.02)
        assert 1e9 < summ.cost.p50 < 5e10  # $1B-$50B for a ~300 mi corridor
        assert 60 < summ.duration.p50 < 360  # 5-30 years
        assert sum(b.count for b in summ.cost.histogram) == 2000
        assert np.corrcoef(cost, dur)[0, 1] > 0  # bigger projects take longer


def test_simulation_deterministic(scored):
    cands, stats = scored
    a, _ = run_simulation(cands[0].key, stats[0], 500)
    b, _ = run_simulation(cands[0].key, stats[0], 500)
    assert np.array_equal(a, b)


# ---------------------------------------------------------------- funding

def test_funding_matches(scored):
    _, stats = scored
    for s in stats:
        matches = match_route(s, 10e9)
        assert len(matches) == 6
        assert [m.fit_score for m in matches] == sorted((m.fit_score for m in matches), reverse=True)
        assert sum(m.eligible and m.fit_score > 0.3 for m in matches) >= 3
        for m in matches:
            cs = m.cost_share
            assert cs.federal_usd + cs.non_federal_usd == pytest.approx(cs.basis_cost_usd, abs=2e5)
            assert 0 <= cs.federal_pct <= 80
            assert m.rationale


def test_nec_only_with_nyc(scored):
    _, stats = scored
    nec = next(m for m in match_route(stats[0], 10e9) if m.program_id == "fsp_nec")
    assert not nec.eligible and nec.cost_share.federal_usd == 0


# ---------------------------------------------------------------- DB round trip

@pytest.mark.skipif(not get_settings().database_url, reason="DATABASE_URL not set")
def test_plan_round_trip_through_tiger():
    from app import db
    from app.planner import list_cities, load_plan, run_plan

    ids = {c.name: c.id for c in list_cities()}
    plan = run_plan(ids["Syracuse"], ids["Rochester"], runs=500)
    try:
        assert plan.request_id is not None
        assert all(r.simulation.source == "tiger_cagg" and r.simulation.runs == 500 for r in plan.routes)
        again = load_plan(plan.request_id)
        assert again is not None and again.cached
        for a, b in zip(plan.routes, again.routes):
            assert a.simulation.cost.p50 == pytest.approx(b.simulation.cost.p50)
            assert [m.program_id for m in a.funding] == [m.program_id for m in b.funding]
    finally:
        with db.connection() as conn:
            route_ids = [r.id for r in plan.routes if r.id]
            conn.execute("DELETE FROM simulation_runs WHERE route_id = ANY(%s)", (route_ids,))
            conn.execute("DELETE FROM corridor_requests WHERE id = %s", (plan.request_id,))
        db.close_pool()
