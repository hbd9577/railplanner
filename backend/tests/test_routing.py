import time

import numpy as np
import pytest
from scipy.ndimage import binary_dilation

from app.routing import generate_candidates, load_cities, load_grid

CITIES = {c["name"]: (c["lon"], c["lat"]) for c in load_cities()}


def test_grid_layers_consistent():
    g = load_grid()
    for name, arr in g.layers.items():
        assert arr.shape == g.shape, name
    assert 50e6 < g.layers["pop"].sum() < 120e6  # NY-Chicago region incl. NJ/PA/OH/IN/N. IL/S. MI
    assert g.layers["row_active"].sum() > 1000
    assert 0 <= g.layers["slope_mean"].min() and g.layers["slope_mean"].max() < 100


@pytest.fixture(scope="module")
def albany_buffalo():
    t0 = time.perf_counter()
    cands = generate_candidates(CITIES["Albany"], CITIES["Buffalo"])
    return cands, time.perf_counter() - t0


def test_three_candidates_fast(albany_buffalo):
    cands, elapsed = albany_buffalo
    assert len(cands) == 3
    assert elapsed < 5
    assert [c.rank for c in cands] == [1, 2, 3]


def test_lengths_plausible(albany_buffalo):
    # Straight line is ~255 mi; Amtrak's Empire Corridor is ~296 mi.
    for c in albany_buffalo[0]:
        assert 250 < c.length_miles < 380, (c.key, c.length_miles)


def test_geojson_endpoints(albany_buffalo):
    for c in albany_buffalo[0]:
        gj = c.geojson()
        assert gj["type"] == "LineString"
        assert np.allclose(gj["coordinates"][0], CITIES["Albany"], atol=0.01)
        assert np.allclose(gj["coordinates"][-1], CITIES["Buffalo"], atol=0.01)


def test_row_strategy_reuses_rail(albany_buffalo):
    g = load_grid()
    row = next(c for c in albany_buffalo[0] if c.key == "row")
    on_row = (g.layers["row_active"][row.cells[:, 0], row.cells[:, 1]] > 0).mean()
    assert on_row > 0.8


def test_candidates_visibly_distinct(albany_buffalo):
    g = load_grid()
    cands = albany_buffalo[0]
    for i, a in enumerate(cands):
        mask = np.zeros(g.shape, dtype=bool)
        mask[a.cells[:, 0], a.cells[:, 1]] = True
        near = binary_dilation(mask, iterations=3)  # within ~3 km
        for b in cands[i + 1:]:
            shared = near[b.cells[:, 0], b.cells[:, 1]].mean()
            assert shared < 0.75, (a.key, b.key, shared)


@pytest.fixture(scope="module")
def nyc_chicago():
    t0 = time.perf_counter()
    cands = generate_candidates(CITIES["New York City"], CITIES["Chicago"])
    return cands, time.perf_counter() - t0


def test_nyc_chicago_template_alternatives(nyc_chicago):
    cands, elapsed = nyc_chicago
    assert [c.key for c in cands] == ["lakeshore", "keystone", "direct"]
    assert elapsed < 30
    by = {c.key: c for c in cands}
    # Straight line ~713 mi; Lake Shore Limited ~960 mi; Pennsylvania routing ~900 mi.
    assert 850 < by["lakeshore"].length_miles < 1050
    assert 780 < by["keystone"].length_miles < 1000
    assert 700 < by["direct"].length_miles < by["keystone"].length_miles


def test_nyc_chicago_passes_corridor_cities(nyc_chicago):
    from app.scoring import route_metrics
    cands, _ = nyc_chicago
    by = {c.key: route_metrics(c)["stations"] for c in cands}
    assert {"Albany", "Buffalo", "Cleveland", "Toledo"} <= set(by["lakeshore"])
    assert {"Philadelphia", "Harrisburg", "Pittsburgh"} <= set(by["keystone"])


def test_routes_stay_in_us(nyc_chicago):
    g = load_grid()
    for c in nyc_chicago[0]:
        assert (g.layers["in_us"][c.cells[:, 0], c.cells[:, 1]] > 0).mean() > 0.99, c.key
