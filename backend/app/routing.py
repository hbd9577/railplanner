"""Cost grid + least-cost path + candidate route generation.

The grid is the 1 km NY raster stack built by scripts/prepare_data.py (EPSG:5070, meters).
Each strategy re-weights the same layers into a traversal-cost surface; route_through_array
finds the cheapest 8-connected path. Later candidates are pushed away from earlier ones so the
2-3 options are visibly distinct.

Cost per cell (dimensionless, 1.0 = flat open rural land), built in cost_surface():
    slope       1 + w_slope * (slope% / 4)^2, capped at 25, damped 70% on existing rail ROW
    urban       x (1 + 2 * w_urban * u), u = 0 at 1k ppl/km2 -> 1 at 5k, waived on active ROW
    env flags   x (1 + w_env * (2.5 protected + 2.5 wetland + 0.6 floodplain))
    rivers      + 3 * w_river (bridge)
    ROW reuse   x (1 - 0.65 w_row) on active rail, x (1 - 0.45 w_row) on inactive, floor 0.08
    population  x (1 - 0.85 * w_pop * p^2), p = log-normalized smoothed population
    length      + w_length (flat per-cell cost favoring shorter paths)
    outside NY  x 4      water (lakes/ocean)  = 200
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from functools import lru_cache

import numpy as np
from pyproj import Transformer
from scipy.ndimage import binary_dilation, gaussian_filter
from shapely.geometry import LineString, mapping
from shapely.ops import transform as shp_transform
from skimage.graph import route_through_array

from .config import DATA_DIR

GRID_NPZ = DATA_DIR / "processed" / "ny_grid.npz"
GRID_META = DATA_DIR / "processed" / "ny_grid_meta.json"
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


# Mirrors the alternative families typical of corridor studies (e.g. NYSDOT Empire Corridor Tier 1 EIS):
# upgrade the existing line, build a new direct alignment, or chase population.
STRATEGIES: list[Strategy] = [
    Strategy("row", "Existing corridor upgrade",
             "Follows existing rail right-of-way wherever possible to minimize new land acquisition.",
             Weights(slope=0.6, urban=0.4, env=0.6, row=1.35)),
    Strategy("direct", "New direct alignment",
             "Greenfield alignment that trades ROW reuse for a shorter, straighter, faster route.",
             Weights(slope=1.0, urban=1.5, env=1.0, row=0.0, length=4.0), diversity=1.5),
    Strategy("population", "Maximum population served",
             "Bends toward population centers to maximize riders within reach of the line.",
             Weights(slope=0.8, urban=0.0, env=1.0, row=0.5, pop=1.0), diversity=1.6, via_cities=True),
]


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
    c = np.where((L["in_ny"] == 0) & (L["water"] == 0), c * 4.0, c)
    c = np.where(L["water"] > 0, 200.0, c)
    return np.maximum(c, 0.05).astype(np.float64)


def _window(g: Grid, a: tuple[int, int], b: tuple[int, int], pad: int = 60) -> tuple[slice, slice]:
    r0, r1 = max(min(a[0], b[0]) - pad, 0), min(max(a[0], b[0]) + pad + 1, g.shape[0])
    c0, c1 = max(min(a[1], b[1]) - pad, 0), min(max(a[1], b[1]) + pad + 1, g.shape[1])
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
        ll = shp_transform(lambda x, y: _to_lonlat.transform(x, y), self.line)
        geom = mapping(ll)
        geom["coordinates"] = [[round(x, 5), round(y, 5)] for x, y in geom["coordinates"]]
        return geom


def generate_candidates(origin: tuple[float, float], dest: tuple[float, float],
                        n: int = 3, strategies: list[Strategy] | None = None) -> list[Candidate]:
    """origin/dest are (lon, lat). Returns up to n distinct candidates in strategy order."""
    g = load_grid()
    a = _snap_to_land(g, g.rc(*origin))
    b = _snap_to_land(g, g.rc(*dest))
    win = _window(g, a, b)
    a_w = (a[0] - win[0].start, a[1] - win[1].start)
    b_w = (b[0] - win[0].start, b[1] - win[1].start)
    shape_w = (win[0].stop - win[0].start, win[1].stop - win[1].start)

    # Endpoint approaches and city cores are exempt from the diversity penalty so candidates can
    # share stations while still diverging between them.
    rr, cc = np.ogrid[: shape_w[0], : shape_w[1]]
    near_ends = ((rr - a_w[0]) ** 2 + (cc - a_w[1]) ** 2 < 12 ** 2) | ((rr - b_w[0]) ** 2 + (cc - b_w[1]) ** 2 < 12 ** 2)
    exempt = near_ends | (g.pop_norm[win] > 0.62)
    vias = _via_points(g, origin, dest, win)
    for v in vias:
        exempt |= (rr - v[0]) ** 2 + (cc - v[1]) ** 2 < 8 ** 2
    used = np.zeros(shape_w, dtype=bool)

    out: list[Candidate] = []
    for i, s in enumerate((strategies or STRATEGIES)[:n]):
        cost = cost_surface(g, s.weights, win)
        if used.any() and s.diversity > 1.0:
            near_used = binary_dilation(used, iterations=3) & ~exempt
            cost = np.where(near_used, cost * s.diversity + (s.diversity - 1.0), cost)
        stops = [a_w, *(vias if s.via_cities else []), b_w]
        legs, total = [], 0.0
        for p0, p1 in zip(stops[:-1], stops[1:]):
            leg, leg_cost = route_through_array(cost, p0, p1, fully_connected=True, geometric=True)
            legs.append(np.asarray(leg) if not legs else np.asarray(leg)[1:])
            total += leg_cost
        cells_w = np.vstack(legs)
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
                window: tuple[slice, slice], max_offset: float = 0.15) -> list[tuple[int, int]]:
    """Window-relative cells of known cities lying between o and d, within `max_offset` x direct
    distance of the straight o-d line, ordered along the corridor."""
    ox, oy = _to_grid.transform(*origin)
    dx, dy = _to_grid.transform(*dest)
    direct = np.hypot(dx - ox, dy - oy)
    picks = []
    for c in load_cities():
        cx, cy = _to_grid.transform(c["lon"], c["lat"])
        d_o, d_d = np.hypot(cx - ox, cy - oy), np.hypot(dx - cx, dy - cy)
        along = ((cx - ox) * (dx - ox) + (cy - oy) * (dy - oy)) / direct
        offset = abs((cx - ox) * (dy - oy) - (cy - oy) * (dx - ox)) / direct
        if min(d_o, d_d) < 15_000 or not (0 < along < direct) or offset > max_offset * direct:
            continue
        r, col = _snap_to_land(g, g.rc(c["lon"], c["lat"]))
        picks.append((along, (r - window[0].start, col - window[1].start)))
    return [rc for _, rc in sorted(picks)]


def load_cities() -> list[dict]:
    return json.loads((DATA_DIR / "cities.json").read_text(encoding="utf-8"))
