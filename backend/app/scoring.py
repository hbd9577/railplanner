"""Per-route metrics and a 0-100 composite score.

Metrics come straight from the grid cells each path visits (1 km cells; route miles are
spread evenly over the path's cells). Composite score, relative to the candidate set:

    component            weight  "best" = 1.0
    population_served     0.30   most residents within BUFFER_MILES of the alignment
    row_reuse             0.20   highest % on existing rail ROW
    environment           0.20   absolute: exp(-flagged_miles / 40); flagged miles on existing
                                 ROW count 25% (upgrading track already there has far less impact)
    terrain               0.15   lowest mean slope
    directness            0.15   shortest length

Benefit metrics score value/max; terrain/directness score min/value. Cost is deliberately NOT
in the score: it is shown as a Monte Carlo range.
"""
from __future__ import annotations

from collections import Counter

import numpy as np
from scipy.ndimage import binary_dilation

from .models import RouteStats, ScoreBreakdown, SegmentMiles
from .routing import Candidate, Grid, load_cities, load_grid

BUFFER_MILES = 10.0  # "population near the alignment" buffer
STATION_RADIUS_KM = 5  # a known city within this distance of the path counts as a station
STATION_CATCHMENT_KM = 10  # straight-line station catchment for "population near stations"
SCORE_WEIGHTS = {
    "population_served": 0.30,
    "row_reuse": 0.20,
    "environment": 0.20,
    "terrain": 0.15,
    "directness": 0.15,
}
ENV_KINDS = ("protected", "wetland", "floodplain")
ENV_SCALE_MILES = 40.0
ENV_ON_ROW_WEIGHT = 0.25

# Class thresholds (documented in the UI/proposal assumptions).
SLOPE_CLASSES = ((3.0, "flat"), (8.0, "rolling"), (float("inf"), "mountainous"))  # mean % grade
DENSITY_CLASSES = ((300.0, "rural"), (1500.0, "suburban"), (float("inf"), "urban"))  # people / km2


def _disk(radius: int) -> np.ndarray:
    y, x = np.ogrid[-radius: radius + 1, -radius: radius + 1]
    return x * x + y * y <= radius * radius


def _classify(values: np.ndarray, classes) -> np.ndarray:
    out = np.empty(values.shape, dtype=object)
    lo = -np.inf
    for hi, name in classes:
        out[(values >= lo) & (values < hi)] = name
        lo = hi
    return out


def _entries(flags: np.ndarray) -> int:
    """Number of times the path enters a flagged run of cells."""
    f = flags.astype(bool)
    return int(f[0]) + int(np.count_nonzero(f[1:] & ~f[:-1])) if f.size else 0


def route_metrics(c: Candidate, g: Grid | None = None) -> dict:
    g = g or load_grid()
    L = g.layers
    r, col = c.cells[:, 0], c.cells[:, 1]
    n = len(r)
    miles_per_cell = c.length_miles / n

    # Population within the buffer, computed on a window around the path for speed.
    rad = int(round(BUFFER_MILES * 1.609344 * 1000 / g.cell))
    r0, r1 = max(r.min() - rad - 1, 0), min(r.max() + rad + 2, g.shape[0])
    c0, c1 = max(col.min() - rad - 1, 0), min(col.max() + rad + 2, g.shape[1])
    mask = np.zeros((r1 - r0, c1 - c0), dtype=bool)
    mask[r - r0, col - c0] = True
    buffered = binary_dilation(mask, structure=_disk(rad))
    pop_served = float(L["pop"][r0:r1, c0:c1][buffered].sum())

    # Stations: known cities within STATION_RADIUS_KM of the path, ordered along the route, with the
    # route mile at the nearest path cell.
    near = binary_dilation(mask, structure=_disk(STATION_RADIUS_KM))
    found = []
    for city in load_cities():
        cr, cc = g.rc(city["lon"], city["lat"])
        if r0 <= cr < r1 and c0 <= cc < c1 and near[cr - r0, cc - c0]:
            k = int(np.argmin((r - cr) ** 2 + (col - cc) ** 2))
            found.append((k, city["name"], (cr, cc)))
    found.sort()
    stations = [name for _, name, _ in found]
    station_miles = [{"name": name, "mile": round(k * miles_per_cell, 1)} for k, name, _ in found]

    # Population near stations: union of STATION_CATCHMENT_KM straight-line disks around stations,
    # so overlapping catchments are counted once.
    srad = int(round(STATION_CATCHMENT_KM * 1000 / g.cell))
    if found:
        sr = np.array([rc[0] for *_, rc in found]); sc = np.array([rc[1] for *_, rc in found])
        a0, a1 = max(sr.min() - srad - 1, 0), min(sr.max() + srad + 2, g.shape[0])
        b0, b1 = max(sc.min() - srad - 1, 0), min(sc.max() + srad + 2, g.shape[1])
        smask = np.zeros((a1 - a0, b1 - b0), dtype=bool)
        smask[sr - a0, sc - b0] = True
        catch = binary_dilation(smask, structure=_disk(srad))
        pop_near_stations = float(L["pop"][a0:a1, b0:b1][catch].sum())
    else:
        pop_near_stations = 0.0

    row_a = L["row_active"][r, col] > 0
    row_i = L["row_inactive"][r, col] > 0
    treatment = np.where(row_a, "upgrade", np.where(row_i, "reactivation", "new"))
    terrain = _classify(L["slope_mean"][r, col], SLOPE_CLASSES)
    density = _classify(L["pop"][r, col], DENSITY_CLASSES)
    seg_counts = Counter(zip(treatment, terrain, density))
    segments = [SegmentMiles(treatment=t, terrain=te, density=d, miles=round(k * miles_per_cell, 2))
                for (t, te, d), k in sorted(seg_counts.items())]

    env_flags = {k: _entries(L[f"env_{k}"][r, col]) for k in ENV_KINDS}
    flagged = np.zeros(n, dtype=bool)
    for k in ENV_KINDS:
        flagged |= L[f"env_{k}"][r, col] > 0
    on_row = row_a | row_i
    env_miles_weighted = float((flagged & ~on_row).sum() + ENV_ON_ROW_WEIGHT * (flagged & on_row).sum()) * miles_per_cell
    river = L["river"][r, col] > 0
    slope = L["slope_mean"][r, col]
    new = treatment == "new"
    return {
        "station_miles": station_miles,
        "pop_near_stations": pop_near_stations,
        "miles_new": float(new.sum() * miles_per_cell),
        "miles_upgrade": float(row_a.sum() * miles_per_cell),
        "miles_reactivation": float((row_i & ~row_a).sum() * miles_per_cell),
        "miles_new_mountainous": float((new & (terrain == "mountainous")).sum() * miles_per_cell),
        "env_miles": {k: round(float((L[f"env_{k}"][r, col] > 0).sum() * miles_per_cell), 1) for k in ENV_KINDS},
        "length_miles": c.length_miles,
        "population_served": pop_served,
        "row_reuse_pct": float((row_a | row_i).mean() * 100),
        "mean_slope_pct": float(slope.mean()),
        "max_slope_pct": float(L["slope_max"][r, col].max()),
        "env_flags": env_flags,
        "env_flag_count": int(sum(env_flags.values())),
        "env_miles_weighted": env_miles_weighted,
        "env_miles_new": float((flagged & ~on_row).sum() * miles_per_cell),
        "river_crossings": _entries(river),
        "river_crossings_new": _entries(river & ~on_row),
        "stations": stations,
        "segments": segments,
    }


def score_routes(metrics: list[dict]) -> list[RouteStats]:
    """Attach relative 0-100 scores to a candidate set's metrics."""
    def benefit(key):
        best = max(m[key] for m in metrics) or 1.0
        return [m[key] / best for m in metrics]

    def cost(key, floor):
        vals = [max(m[key], floor) for m in metrics]
        best = min(vals)
        return [best / v for v in vals]

    comps = {
        "population_served": benefit("population_served"),
        "row_reuse": benefit("row_reuse_pct"),
        "environment": [float(np.exp(-m["env_miles_weighted"] / ENV_SCALE_MILES)) for m in metrics],
        "terrain": cost("mean_slope_pct", 0.5),
        "directness": cost("length_miles", 1.0),
    }
    out = []
    for i, m in enumerate(metrics):
        components = {k: round(v[i], 3) for k, v in comps.items()}
        score = 100 * sum(SCORE_WEIGHTS[k] * components[k] for k in SCORE_WEIGHTS)
        out.append(RouteStats(
            length_miles=round(m["length_miles"], 1),
            population_served=int(round(m["population_served"], -3)),
            buffer_miles=BUFFER_MILES,
            row_reuse_pct=round(m["row_reuse_pct"], 1),
            mean_slope_pct=round(m["mean_slope_pct"], 1),
            max_slope_pct=round(m["max_slope_pct"], 1),
            env_flag_count=m["env_flag_count"],
            env_flags=m["env_flags"],
            river_crossings=m["river_crossings"],
            river_crossings_new=m["river_crossings_new"],
            station_miles=m["station_miles"],
            pop_near_stations=int(round(m["pop_near_stations"], -3)),
            station_catchment_km=STATION_CATCHMENT_KM,
            miles_new=round(m["miles_new"], 1),
            miles_upgrade=round(m["miles_upgrade"], 1),
            miles_reactivation=round(m["miles_reactivation"], 1),
            miles_new_mountainous=round(m["miles_new_mountainous"], 1),
            env_miles=m["env_miles"],
            env_miles_new=round(m["env_miles_new"], 1),
            stations=m["stations"],
            segments=m["segments"],
            score=round(score, 1),
            score_breakdown=ScoreBreakdown(components=components, weights=SCORE_WEIGHTS),
        ))
    return out
