"""Cost grid + least-cost path + candidate route generation.

The grid is the 1 km New York - Chicago raster stack built by scripts/prepare_data.py
(EPSG:5070, meters). Each strategy re-weights the same layers into a traversal-cost surface;
route_through_array finds the cheapest 8-connected path, leg by leg between any via cities.
Later candidates are pushed away from earlier ones so the 2-3 options are visibly distinct.

Long corridors use CORRIDOR_TEMPLATES: named alternatives that pass through real corridor
cities (e.g. the Lake Shore and Pennsylvania routes for New York - Chicago), with least-cost
routing between them. Free-form routing over ~800 miles wanders; templates keep each
alternative on the corridor it is named for.

Cost per cell (dimensionless, 1.0 = flat open rural land), built in cost_surface():
    slope       1 + w_slope * (slope% / 4)^2, capped at 25, damped 70% on existing rail ROW
    urban       x (1 + 2 * w_urban * u), u = 0 at 1k ppl/km2 -> 1 at 5k, waived on active ROW
    env flags   x (1 + w_env * (2.5 protected + 2.5 wetland + 0.6 floodplain))
    rivers      + 3 * w_river (bridge)
    ROW reuse   x (1 - 0.65 w_row) on active rail, x (1 - 0.45 w_row) on inactive, floor 0.08
    population  x (1 - 0.85 * w_pop * p^2), p = log-normalized smoothed population
    length      + w_length (flat per-cell cost favoring shorter paths)
    blocked     water (lakes/ocean) and non-US land (Canada) = 200
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field, replace
from functools import lru_cache

import numpy as np
from pyproj import Transformer
from scipy.ndimage import binary_dilation, gaussian_filter
import shapely
from shapely.geometry import LineString, mapping
from skimage.graph import route_through_array

from .config import DATA_DIR

GRID_NPZ = DATA_DIR / "processed" / "grid.npz"
GRID_META = DATA_DIR / "processed" / "grid_meta.json"
METERS_PER_MILE = 1609.344

_to_grid = Transformer.from_crs("EPSG:4326", "EPSG:5070", always_xy=True)
_to_lonlat = Transformer.from_crs("EPSG:5070", "EPSG:4326", always_xy=True)


@dataclass(frozen=True)
class Weights:
    slope: float = 1.0
    urban: float = 1.0
    env: float = 1.0
    river: float = 1.0
    row: float = 1.0
    pop: float = 0.0
    length: float = 0.0  # flat per-cell cost; higher = shorter, straighter paths


@dataclass(frozen=True)
class Strategy:
    key: str
    label: str
    description: str
    weights: Weights
    # Cost multiplier on cells near earlier candidates (1 = ignore them). City cores are exempt.
    diversity: float = 1.0
    # Route through intermediate cities inside the corridor ellipse, in order along the corridor.
    via_cities: bool = False
    # Explicit via cities (by name, in origin -> destination order); used by corridor templates.
    via: tuple[str, ...] = ()


# Mirrors the alternative families typical of corridor studies (e.g. NYSDOT Empire Corridor Tier 1 EIS):
# upgrade the existing line, build a new direct alignment, or connect intermediate cities.
STRATEGIES: list[Strategy] = [
    Strategy("row", "Existing corridor upgrade",
             "Follows existing rail right-of-way wherever possible to minimize new land acquisition.",
             Weights(slope=0.6, urban=0.4, env=0.6, row=1.35)),
    Strategy("direct", "New direct alignment",
             "Greenfield alignment that trades ROW reuse for a shorter, straighter, faster route.",
             Weights(slope=1.0, urban=1.5, env=1.0, row=0.0, length=4.0), diversity=1.5),
    Strategy("cities", "Via intermediate cities",
             "Routes through the largest intermediate cities that fit within a 25% detour of a straight "
             "line, so more cities can have stations. It connects cities; it does not maximize the "
             "population near the line.",
             Weights(slope=0.8, urban=0.0, env=1.0, row=0.5, pop=1.0), diversity=1.6, via_cities=True),
]

_UPGRADE = Weights(slope=0.6, urban=0.4, env=0.6, row=1.35)

# Named alternatives for long corridors, keyed (origin, destination); reversed pairs reverse the vias.
CORRIDOR_TEMPLATES: dict[tuple[str, str], list[Strategy]] = {
    ("New York City", "Chicago"): [
        Strategy("lakeshore", "Lake Shore corridor upgrade",
                 "Upgrades the existing water-level route (Hudson Line, Empire Corridor, Lake Erie shore) via "
                 "Albany, Buffalo, Cleveland and Toledo, the path of Amtrak's Lake Shore Limited.",
                 _UPGRADE, via=("Albany", "Buffalo", "Erie", "Cleveland", "Toledo", "South Bend")),
        Strategy("keystone", "Pennsylvania corridor upgrade",
                 "Upgrades the Northeast Corridor, Keystone Corridor and former Pennsylvania Railroad main "
                 "lines via Philadelphia, Harrisburg, Pittsburgh and Fort Wayne across the Appalachians.",
                 _UPGRADE, via=("Philadelphia", "Harrisburg", "Pittsburgh", "Fort Wayne")),
        Strategy("direct", "New direct high-speed alignment",
                 "Greenfield alignment across Pennsylvania and Ohio that minimizes distance at the cost of "
                 "new right-of-way and mountain structures.",
                 Weights(slope=1.0, urban=1.5, env=1.0, row=0.0, length=4.0), diversity=1.5),
    ],
}


@dataclass
class Grid:
    layers: dict[str, np.ndarray]
    x0: float
    y0: float
    cell: float
    shape: tuple[int, int]
    meta: dict
    pop_norm: np.ndarray = field(repr=False, default=None)  # type: ignore[assignment]

    def rc(self, lon: float, lat: float) -> tuple[int, int]:
        x, y = _to_grid.transform(lon, lat)
        return int((self.y0 - y) // self.cell), int((x - self.x0) // self.cell)

    def xy(self, rows: np.ndarray, cols: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        return self.x0 + (cols + 0.5) * self.cell, self.y0 - (rows + 0.5) * self.cell


@lru_cache
def load_grid() -> Grid:
    if not GRID_NPZ.exists():
        raise FileNotFoundError(f"{GRID_NPZ} missing: run `python -m scripts.prepare_data` in backend/")
    with np.load(GRID_NPZ) as z:
        layers = {k: z[k] for k in z.files}
    meta = json.loads(GRID_META.read_text(encoding="utf-8"))
    a, _, x0, _, e, y0 = meta["transform"]
    grid = Grid(layers=layers, x0=x0, y0=y0, cell=a, shape=tuple(meta["shape"]), meta=meta)
    smooth = gaussian_filter(layers["pop"].astype(np.float64), sigma=4)
    grid.pop_norm = (np.log1p(smooth) / np.log1p(smooth.max())).astype(np.float32)
    return grid


def cost_surface(g: Grid, w: Weights, window: tuple[slice, slice]) -> np.ndarray:
    L = {k: v[window].astype(np.float32) for k, v in g.layers.items()}
    row_a, row_i = L["row_active"], L["row_inactive"]

    slope_term = np.minimum(w.slope * (L["slope_mean"] / 4.0) ** 2, 24.0) * (1 - 0.7 * np.maximum(row_a, row_i))
    c = 1.0 + slope_term
    urban = np.clip((L["pop"] - 1000.0) / 4000.0, 0.0, 1.0)
    c *= 1.0 + 2.0 * w.urban * urban * (1 - row_a)
    c *= 1.0 + w.env * (2.5 * L["env_protected"] + 2.5 * L["env_wetland"] + 0.6 * L["env_floodplain"])
    c += 3.0 * w.river * L["river"]
    row_mult = np.where(row_a > 0, 1 - 0.65 * w.row, np.where(row_i > 0, 1 - 0.45 * w.row, 1.0))
    c *= np.maximum(row_mult, 0.08)
    c *= 1.0 - 0.85 * w.pop * g.pop_norm[window] ** 2
    c += w.length
    c = np.where((L["water"] > 0) | (L["in_us"] == 0), 200.0, c)
    return np.maximum(c, 0.05).astype(np.float64)


def _window(shape: tuple[int, int], points: list[tuple[int, int]], pad: int = 60) -> tuple[slice, slice]:
    rows, cols = [p[0] for p in points], [p[1] for p in points]
    r0, r1 = max(min(rows) - pad, 0), min(max(rows) + pad + 1, shape[0])
    c0, c1 = max(min(cols) - pad, 0), min(max(cols) + pad + 1, shape[1])
    return slice(r0, r1), slice(c0, c1)


def _snap_to_land(g: Grid, rc: tuple[int, int], radius: int = 5) -> tuple[int, int]:
    water = g.layers["water"]
    if not water[rc]:
        return rc
    best = None
    for dr in range(-radius, radius + 1):
        for dc in range(-radius, radius + 1):
            r, c = rc[0] + dr, rc[1] + dc
            if 0 <= r < g.shape[0] and 0 <= c < g.shape[1] and not water[r, c]:
                d = dr * dr + dc * dc
                if best is None or d < best[0]:
                    best = (d, (r, c))
    return best[1] if best else rc


def _chaikin(coords: np.ndarray, iters: int = 2) -> np.ndarray:
    for _ in range(iters):
        q = 0.75 * coords[:-1] + 0.25 * coords[1:]
        r = 0.25 * coords[:-1] + 0.75 * coords[1:]
        mid = np.empty((2 * len(q), 2))
        mid[0::2], mid[1::2] = q, r
        coords = np.vstack([coords[:1], mid, coords[-1:]])
    return coords


@dataclass
class Candidate:
    rank: int
    key: str
    label: str
    description: str
    cells: np.ndarray  # (n, 2) row/col indices into the full grid, in path order
    line: LineString  # EPSG:5070, smoothed
    path_cost: float

    @property
    def length_miles(self) -> float:
        return self.line.length / METERS_PER_MILE

    def geojson(self) -> dict:
        ll = shapely.transform(self.line, lambda xy: np.column_stack(_to_lonlat.transform(xy[:, 0], xy[:, 1])))
        geom = mapping(ll)
        geom["coordinates"] = [[round(x, 5), round(y, 5)] for x, y in geom["coordinates"]]
        return geom


def _city_name_at(lonlat: tuple[float, float]) -> str | None:
    for c in load_cities():
        if abs(c["lon"] - lonlat[0]) < 0.01 and abs(c["lat"] - lonlat[1]) < 0.01:
            return c["name"]
    return None


def template_for(origin: tuple[float, float], dest: tuple[float, float]) -> list[Strategy] | None:
    """Corridor template for this city pair (either direction), or None for free-form strategies."""
    pair = (_city_name_at(origin), _city_name_at(dest))
    if pair in CORRIDOR_TEMPLATES:
        return CORRIDOR_TEMPLATES[pair]
    if pair[::-1] in CORRIDOR_TEMPLATES:
        return [replace(s, via=s.via[::-1]) for s in CORRIDOR_TEMPLATES[pair[::-1]]]
    return None


def _route_legs(cost: np.ndarray, stops: list[tuple[int, int]], pad: int = 40) -> tuple[np.ndarray, float]:
    """Least-cost path through stops, each leg solved on a sub-window around its endpoints."""
    legs, total = [], 0.0
    for p0, p1 in zip(stops[:-1], stops[1:]):
        sub = _window(cost.shape, [p0, p1], pad)
        off = np.array([sub[0].start, sub[1].start])
        leg, leg_cost = route_through_array(cost[sub], tuple(np.subtract(p0, off)), tuple(np.subtract(p1, off)),
                                            fully_connected=True, geometric=True)
        leg = np.asarray(leg) + off
        legs.append(leg if not legs else leg[1:])
        total += leg_cost
    return np.vstack(legs), total


def generate_candidates(origin: tuple[float, float], dest: tuple[float, float],
                        n: int = 3, strategies: list[Strategy] | None = None) -> list[Candidate]:
    """origin/dest are (lon, lat). Returns up to n distinct candidates in strategy order."""
    g = load_grid()
    strategies = (strategies or template_for(origin, dest) or STRATEGIES)[:n]
    a = _snap_to_land(g, g.rc(*origin))
    b = _snap_to_land(g, g.rc(*dest))
    named = {c["name"]: c for c in load_cities()}
    generic_vias = _via_points(g, origin, dest) if any(s.via_cities for s in strategies) else []
    stops_full = []
    for s in strategies:
        if s.via:
            vias = [_snap_to_land(g, g.rc(named[v]["lon"], named[v]["lat"])) for v in s.via]
        else:
            vias = generic_vias if s.via_cities else []
        stops_full.append([a, *vias, b])

    win = _window(g.shape, [p for stops in stops_full for p in stops])
    off = (win[0].start, win[1].start)
    to_w = lambda p: (p[0] - off[0], p[1] - off[1])  # noqa: E731
    shape_w = (win[0].stop - win[0].start, win[1].stop - win[1].start)

    # Endpoint approaches, via cities and city cores are exempt from the diversity penalty so
    # candidates can share stations while still diverging between them.
    rr, cc = np.ogrid[: shape_w[0], : shape_w[1]]
    exempt = g.pop_norm[win] > 0.62
    for stops in stops_full:
        for i, p in enumerate(stops):
            r_ex = 12 if i in (0, len(stops) - 1) else 8
            pw = to_w(p)
            exempt |= (rr - pw[0]) ** 2 + (cc - pw[1]) ** 2 < r_ex ** 2
    used = np.zeros(shape_w, dtype=bool)

    out: list[Candidate] = []
    for i, (s, stops) in enumerate(zip(strategies, stops_full)):
        cost = cost_surface(g, s.weights, win)
        if used.any() and s.diversity > 1.0:
            near_used = binary_dilation(used, iterations=3) & ~exempt
            cost = np.where(near_used, cost * s.diversity + (s.diversity - 1.0), cost)
        cells_w, total = _route_legs(cost, [to_w(p) for p in stops])
        used[cells_w[:, 0], cells_w[:, 1]] = True
        cells = cells_w + np.array([win[0].start, win[1].start])

        xs, ys = g.xy(cells[:, 0], cells[:, 1])
        ox, oy = _to_grid.transform(*origin)
        dx, dy = _to_grid.transform(*dest)
        raw = LineString(np.column_stack([np.r_[ox, xs, dx], np.r_[oy, ys, dy]]))
        simple = np.asarray(raw.simplify(800).coords)
        line = LineString(_chaikin(simple, iters=3))
        out.append(Candidate(rank=i + 1, key=s.key, label=s.label, description=s.description,
                             cells=cells, line=line, path_cost=float(total)))
    return out


def _via_points(g: Grid, origin: tuple[float, float], dest: tuple[float, float],
                max_detour: float = 1.25, max_offset: float = 0.2) -> list[tuple[int, int]]:
    """Grid cells of intermediate cities to route through, in travel order.

    Cheapest insertion: candidate cities (between o and d, within `max_offset` x direct distance
    of the o-d line) are tried largest-population first; each is inserted at the position that
    adds the least straight-line distance, and kept only if the whole chain stays within
    `max_detour` x the direct distance. This avoids zig-zagging between cities on both sides of
    a long corridor. It connects cities; it does not maximize population near the line.
    """
    ox, oy = _to_grid.transform(*origin)
    dx, dy = _to_grid.transform(*dest)
    direct = float(np.hypot(dx - ox, dy - oy))
    cands = []
    for c in load_cities():
        cx, cy = _to_grid.transform(c["lon"], c["lat"])
        along = ((cx - ox) * (dx - ox) + (cy - oy) * (dy - oy)) / direct
        offset = abs((cx - ox) * (dy - oy) - (cy - oy) * (dx - ox)) / direct
        near_end = min(np.hypot(cx - ox, cy - oy), np.hypot(dx - cx, dy - cy)) < 15_000
        if near_end or not (0 < along < direct) or offset > max_offset * direct:
            continue
        cands.append((c.get("population") or 0, (cx, cy), c))
    chain = [(ox, oy), (dx, dy)]

    def length(pts):
        return sum(float(np.hypot(b[0] - a[0], b[1] - a[1])) for a, b in zip(pts[:-1], pts[1:]))

    picked = []
    for _, xy, c in sorted(cands, key=lambda t: -t[0]):
        best = None
        for i in range(1, len(chain)):
            trial = chain[:i] + [xy] + chain[i:]
            L = length(trial)
            if best is None or L < best[0]:
                best = (L, i)
        if best and best[0] <= max_detour * direct:
            chain.insert(best[1], xy)
            picked.append((xy, c))
    order = {xy: k for k, xy in enumerate(chain)}
    picked.sort(key=lambda t: order[t[0]])
    return [_snap_to_land(g, g.rc(c["lon"], c["lat"])) for _, c in picked]


def load_cities() -> list[dict]:
    return json.loads((DATA_DIR / "cities.json").read_text(encoding="utf-8"))
