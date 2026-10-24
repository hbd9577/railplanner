"""Monte Carlo cost and schedule, persisted to Tiger Data and summarized from the continuous aggregate.

Cost model (per run; all inputs from data/cost_benchmarks.csv, ILLUSTRATIVE not calibrated):
    track       sum over route segments: miles x PERT(new_track[terrain, density])
                x PERT(upgrade_factor | reactivation_factor) for segments on existing ROW
    heavy       new mountainous miles x PERT(share) x PERT(heavy_structure $/mi)
    grade sep   miles x PERT(rate[density]) x PERT(grade_separation $/crossing)
    bridges     new crossings x PERT(bridge); crossings on existing ROW x 0.4 (rehab)
    stations    stations x PERT(station)
    total       subtotal x market factor (lognormal, sigma 0.08, shared by all items in a run)
                x (1 + PERT(contingency))
One draw per item per run, so items move together within a run (conservative: wider ranges).

Schedule model (months, triangular; simple critical path):
    planning/NEPA  [T(24, 36, 60) + env_flag_count x T(1, 3, 6)] x (1 - 0.35 x row_reuse_share)
                   (work inside existing ROW typically gets a lighter environmental review)
    design         T(18, 24, 36) x (cost / $5B)^0.25
    procurement    T(6, 12, 24), overlapping the last 25% of design
    construction   T(36, 54, 84) x (miles / 150)^0.3 x (cost / median cost)^0.5
Construction duration scales with the sampled cost, so cost and schedule are positively correlated.
"""
from __future__ import annotations

import csv
import zlib
from datetime import datetime, timedelta, timezone
from functools import lru_cache

import numpy as np

from . import db
from .config import DATA_DIR
from .models import Distribution, HistogramBin, RouteStats, SimulationSummary

# Must match the continuous aggregate definition in sql/schema.sql.
COST_LOG10_RANGE = (7.0, 11.0)  # $10M .. $100B
COST_BINS = 1000
DUR_RANGE = (0.0, 480.0)  # months
DUR_BINS = 960
DISPLAY_BINS = 30


@lru_cache
def load_benchmarks() -> dict[tuple[str, str, str], tuple[float, float, float]]:
    with open(DATA_DIR / "cost_benchmarks.csv", newline="", encoding="utf-8") as f:
        return {(r["item"], r["terrain"], r["density"]): (float(r["low"]), float(r["mode"]), float(r["high"]))
                for r in csv.DictReader(f)}


def pert(rng: np.random.Generator, low: float, mode: float, high: float, size: int) -> np.ndarray:
    if high <= low:
        return np.full(size, mode)
    a = 1 + 4 * (mode - low) / (high - low)
    b = 1 + 4 * (high - mode) / (high - low)
    return low + rng.beta(a, b, size) * (high - low)


def _seed(key: str, stats: RouteStats) -> int:
    return zlib.crc32(f"{key}:{stats.length_miles:.1f}:{stats.row_reuse_pct:.1f}".encode())


def simulate(stats: RouteStats, n: int, seed: int) -> tuple[np.ndarray, np.ndarray]:
    """Returns (cost_usd[n], duration_months[n])."""
    bm = load_benchmarks()
    rng = np.random.default_rng(seed)
    P = lambda item, terrain="any", density="any": pert(rng, *bm[(item, terrain, density)], n)  # noqa: E731
    M = 1e6

    upgrade = P("upgrade_factor")
    reactivation = P("reactivation_factor")
    cost = np.zeros(n)
    draws: dict[tuple[str, str], np.ndarray] = {}
    for seg in stats.segments:
        cls = (seg.terrain, seg.density)
        if cls not in draws:
            draws[cls] = P("new_track", *cls) * M
        factor = {"upgrade": upgrade, "reactivation": reactivation}.get(seg.treatment, 1.0)
        cost += seg.miles * draws[cls] * factor

    new_mountain = sum(s.miles for s in stats.segments if s.treatment == "new" and s.terrain == "mountainous")
    if new_mountain:
        cost += new_mountain * P("heavy_structure_share", "mountainous") * P("heavy_structure", "mountainous") * M

    miles_by_density: dict[str, float] = {}
    for s in stats.segments:
        miles_by_density[s.density] = miles_by_density.get(s.density, 0.0) + s.miles
    sep_cost = P("grade_separation") * M
    for density, miles in miles_by_density.items():
        cost += miles * P("grade_separation_rate", "any", density) * sep_cost

    bridge = P("bridge") * M
    cost += stats.river_crossings_new * bridge + (stats.river_crossings - stats.river_crossings_new) * 0.4 * bridge
    cost += len(stats.stations) * P("station") * M

    cost *= rng.lognormal(0.0, 0.08, n)
    cost *= 1 + P("contingency")

    tri = lambda lo, mode, hi: rng.triangular(lo, mode, hi, n)  # noqa: E731
    nepa = (tri(24, 36, 60) + stats.env_flag_count * tri(1, 3, 6)) * (1 - 0.35 * stats.row_reuse_pct / 100)
    design = tri(18, 24, 36) * (cost / 5e9) ** 0.25
    procurement = np.maximum(tri(6, 12, 24) - 0.25 * design, 0)
    construction = tri(36, 54, 84) * (stats.length_miles / 150) ** 0.3 * (cost / np.median(cost)) ** 0.5
    duration = nepa + design + procurement + construction
    return cost, np.clip(duration, DUR_RANGE[0], DUR_RANGE[1] - 0.01)


# ---------------------------------------------------------------- summaries

def _cost_edges() -> np.ndarray:
    return 10 ** np.linspace(*COST_LOG10_RANGE, COST_BINS + 1)


def _dur_edges() -> np.ndarray:
    return np.linspace(*DUR_RANGE, DUR_BINS + 1)


def _summarize(counts: np.ndarray, edges: np.ndarray, unit: str, mean: float, lo: float, hi: float,
               log_interp: bool) -> Distribution:
    """counts = histogram() output: [underflow, b_1..b_k, overflow]. Percentiles interpolate within bins."""
    inner = counts[1:-1].astype(float)
    total = counts.sum()
    cum = np.cumsum(inner) + counts[0]

    def pct(p: float) -> float:
        target = p * total
        i = int(np.searchsorted(cum, target))
        i = min(i, len(inner) - 1)
        prev = cum[i - 1] if i > 0 else counts[0]
        frac = (target - prev) / inner[i] if inner[i] else 0.5
        a, b = edges[i], edges[i + 1]
        return float(10 ** (np.log10(a) + frac * (np.log10(b) - np.log10(a)))) if log_interp else float(a + frac * (b - a))

    nz = np.nonzero(inner)[0]
    first, last = (nz[0], nz[-1]) if nz.size else (0, len(inner) - 1)
    step = max(1, int(np.ceil((last - first + 1) / DISPLAY_BINS)))
    bins = [HistogramBin(lo=float(edges[j]), hi=float(edges[min(j + step, len(edges) - 1)]),
                         count=int(inner[j:j + step].sum()))
            for j in range(first, last + 1, step)]
    return Distribution(unit=unit, p10=pct(0.10), p50=pct(0.50), p90=pct(0.90),
                        mean=float(mean), min=float(lo), max=float(hi), histogram=bins)


def summarize_local(cost: np.ndarray, duration: np.ndarray) -> SimulationSummary:
    """Same binning as the continuous aggregate, computed in-process (fallback when the DB is down)."""
    def hist(values, edges):
        inner, _ = np.histogram(values, bins=edges)
        return np.r_[np.sum(values < edges[0]), inner, np.sum(values >= edges[-1])]

    return SimulationSummary(
        runs=len(cost), source="local",
        cost=_summarize(hist(np.log10(cost), np.linspace(*COST_LOG10_RANGE, COST_BINS + 1)), _cost_edges(),
                        "usd", cost.mean(), cost.min(), cost.max(), log_interp=True),
        duration=_summarize(hist(duration, _dur_edges()), _dur_edges(), "months",
                            duration.mean(), duration.min(), duration.max(), log_interp=False),
    )


# ---------------------------------------------------------------- persistence

def write_runs(route_id: int, cost: np.ndarray, duration: np.ndarray) -> None:
    """COPY all runs into the simulation_runs hypertable (one microsecond apart)."""
    t0 = datetime.now(timezone.utc)
    with db.connection() as conn, conn.cursor() as cur:
        with cur.copy("COPY simulation_runs (time, route_id, run_id, cost_usd, duration_months) FROM STDIN") as cp:
            for i in range(len(cost)):
                cp.write_row((t0 + timedelta(microseconds=i), route_id, i, float(cost[i]), float(duration[i])))


def summarize_from_db(route_ids: list[int]) -> dict[int, SimulationSummary]:
    """Read the route_sim_stats continuous aggregate (real-time) and merge its daily buckets."""
    with db.connection() as conn:
        rows = conn.execute(
            "SELECT route_id, n, cost_min, cost_max, cost_mean, dur_min, dur_max, dur_mean, cost_hist, dur_hist "
            "FROM route_sim_stats WHERE route_id = ANY(%s)", (route_ids,)
        ).fetchall()
    grouped: dict[int, list[dict]] = {}
    for r in rows:
        grouped.setdefault(r["route_id"], []).append(r)
    out = {}
    for rid, rs in grouped.items():
        n = sum(r["n"] for r in rs)
        cost_hist = np.sum([np.asarray(r["cost_hist"]) for r in rs], axis=0)
        dur_hist = np.sum([np.asarray(r["dur_hist"]) for r in rs], axis=0)
        cost_mean = sum(r["cost_mean"] * r["n"] for r in rs) / n
        dur_mean = sum(r["dur_mean"] * r["n"] for r in rs) / n
        out[rid] = SimulationSummary(
            runs=int(n), source="tiger_cagg",
            cost=_summarize(cost_hist, _cost_edges(), "usd", cost_mean,
                            min(r["cost_min"] for r in rs), max(r["cost_max"] for r in rs), log_interp=True),
            duration=_summarize(dur_hist, _dur_edges(), "months", dur_mean,
                                min(r["dur_min"] for r in rs), max(r["dur_max"] for r in rs), log_interp=False),
        )
    return out


def run_simulation(key: str, stats: RouteStats, n: int) -> tuple[np.ndarray, np.ndarray]:
    return simulate(stats, n, _seed(key, stats))
