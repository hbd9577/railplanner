"""End-to-end plan pipeline: routing -> scoring -> Monte Carlo -> funding, persisted to Tiger Data.

run_plan() writes the request, routes, every simulation run, and funding matches, then reads the
cost/schedule summaries back from the route_sim_stats continuous aggregate. With persist=False
(or when the DB is unreachable) it computes the same summaries in-process.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from functools import lru_cache

from psycopg.types.json import Jsonb

from . import db
from .config import DATA_DIR, get_settings
from .funding import load_programs, match_route
from .models import City, FundingMatch, PlanResult, RouteResult, RouteStats
from .routing import generate_candidates, load_cities, load_grid
from .scoring import BUFFER_MILES, route_metrics, score_routes
from .service import evaluate as evaluate_service
from .simulation import run_simulation, summarize_from_db, summarize_local, write_runs

log = logging.getLogger(__name__)

# Bump when routing/scoring/simulation changes what a plan contains; older stored plans and demo
# caches are then recomputed instead of being served.
MODEL_VERSION = "2026.10.25-4"


def assumptions(runs: int) -> list[str]:
    return [
        "Illustrative estimates: per-mile cost benchmarks are placeholders bracketed by publicly reported "
        "US rail projects, not calibrated engineering estimates.",
        "Protected areas and wildlife refuges come from USGS PAD-US (GAP status 1-2); floodplains are an "
        "approximate proxy (river corridors plus hand-digitized outlines), not FEMA flood maps.",
        f"Population served counts 2020 Census residents within {BUFFER_MILES:.0f} miles of the alignment.",
        "Alignments are conceptual paths on a 1 km grid, not engineered designs. Long corridors follow named "
        "alternatives through real corridor cities, with least-cost routing between them.",
        f"Cost and schedule come from {runs} Monte Carlo runs per route; P10/P50/P90 are read from "
        "TimescaleDB continuous-aggregate histograms (about 1% bin resolution).",
        "Funding program parameters are approximate and change with each funding round.",
    ]


# ---------------------------------------------------------------- cities

def list_cities() -> list[City]:
    try:
        with db.connection() as conn:
            rows = conn.execute("SELECT id, name, state, lat, lon, population FROM cities ORDER BY id").fetchall()
        return [City(**r) for r in rows]
    except Exception as e:  # noqa: BLE001 - DB down: ids follow cities.json order (same as the seed)
        log.warning("cities from file (db unavailable: %s)", e)
        return [City(id=i + 1, **c) for i, c in enumerate(load_cities())]


def get_city(city_id: int) -> City:
    for c in list_cities():
        if c.id == city_id:
            return c
    raise KeyError(f"unknown city id {city_id}")


@lru_cache
def _has_postgis() -> bool:
    try:
        return "postgis" in db.db_info()["extensions"]
    except Exception:  # noqa: BLE001
        return False


# ---------------------------------------------------------------- run

def run_plan(origin_id: int, dest_id: int, runs: int | None = None, persist: bool = True) -> PlanResult:
    if origin_id == dest_id:
        raise ValueError("origin and destination must differ")
    runs = runs or get_settings().sim_runs
    origin, dest = get_city(origin_id), get_city(dest_id)

    cands = generate_candidates((origin.lon, origin.lat), (dest.lon, dest.lat))
    stats = score_routes([route_metrics(c) for c in cands])
    draws = [run_simulation(c.key, s, runs) for c, s in zip(cands, stats)]

    request_id, route_ids, sims = None, [None] * len(cands), None
    if persist:
        try:
            request_id, route_ids = _persist_routes(origin_id, dest_id, cands, stats)
            for rid, (cost, dur) in zip(route_ids, draws):
                write_runs(rid, cost, dur)
            from_db = summarize_from_db(route_ids)
            sims = [from_db[rid] for rid in route_ids]
        except Exception as e:  # noqa: BLE001 - keep the demo path alive without the DB
            log.exception("persist failed, falling back to local summaries: %s", e)
            request_id, route_ids = None, [None] * len(cands)
    if sims is None:
        sims = [summarize_local(cost, dur) for cost, dur in draws]

    routes = []
    for c, s, sim, rid in zip(cands, stats, sims, route_ids):
        routes.append(RouteResult(id=rid, rank=c.rank, key=c.key, label=c.label, description=c.description,
                                  geometry=c.geojson(), stats=s, simulation=sim,
                                  funding=match_route(s, sim.cost.p50)))
    if request_id is not None:
        _persist_funding(routes)
    attach_service(routes)

    return PlanResult(model_version=MODEL_VERSION, request_id=request_id, origin=origin, destination=dest, routes=routes,
                      assumptions=assumptions(runs), data_sources=load_grid().meta["sources"],
                      created_at=datetime.now(timezone.utc).isoformat(timespec="seconds"))


def _persist_routes(origin_id, dest_id, cands, stats) -> tuple[int, list[int]]:
    geom_sql = "ST_SetSRID(ST_GeomFromGeoJSON(%(gj_text)s), 4326)" if _has_postgis() else None
    with db.connection() as conn, conn.transaction():
        req = conn.execute(
            "INSERT INTO corridor_requests (origin_city_id, dest_city_id, params) VALUES (%s, %s, %s) RETURNING id",
            (origin_id, dest_id, Jsonb({"model_version": MODEL_VERSION}))).fetchone()["id"]
        ids = []
        for c, s in zip(cands, stats):
            gj = c.geojson()
            params = {
                "req": req, "rank": c.rank, "label": c.label, "strategy": c.key, "desc": c.description,
                "gj": Jsonb(gj), "gj_text": json.dumps(gj), "len": s.length_miles, "pop": s.population_served,
                "row": s.row_reuse_pct, "slope": s.mean_slope_pct, "maxslope": s.max_slope_pct,
                "env": s.env_flag_count, "score": s.score,
                "breakdown": Jsonb(s.score_breakdown.model_dump()), "stats": Jsonb(s.model_dump()),
            }
            cols = ("request_id, rank, label, strategy, strategy_description, geojson, length_miles, "
                    "population_served, row_reuse_pct, mean_slope, max_slope, env_flag_count, score, "
                    "score_breakdown, stats")
            vals = ("%(req)s, %(rank)s, %(label)s, %(strategy)s, %(desc)s, %(gj)s, %(len)s, %(pop)s, %(row)s, "
                    "%(slope)s, %(maxslope)s, %(env)s, %(score)s, %(breakdown)s, %(stats)s")
            if geom_sql:
                cols += ", geom"
                vals += ", " + geom_sql
            ids.append(conn.execute(f"INSERT INTO routes ({cols}) VALUES ({vals}) RETURNING id", params)
                       .fetchone()["id"])
    return req, ids


def _persist_funding(routes: list[RouteResult]) -> None:
    with db.connection() as conn, conn.transaction():
        for p in load_programs():
            conn.execute(
                "INSERT INTO funding_programs (id, name, agency, details) VALUES (%s, %s, %s, %s) "
                "ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, agency = EXCLUDED.agency, "
                "details = EXCLUDED.details",
                (p["id"], p["name"], p["agency"], Jsonb(p)))
        for r in routes:
            for m in r.funding:
                conn.execute(
                    "INSERT INTO route_funding_matches (route_id, program_id, fit_score, rationale, cost_share, details) "
                    "VALUES (%s, %s, %s, %s, %s, %s) ON CONFLICT (route_id, program_id) DO UPDATE SET "
                    "fit_score = EXCLUDED.fit_score, rationale = EXCLUDED.rationale, "
                    "cost_share = EXCLUDED.cost_share, details = EXCLUDED.details",
                    (r.id, m.program_id, m.fit_score, m.rationale, Jsonb(m.cost_share.model_dump()),
                     Jsonb(m.model_dump())))


# ---------------------------------------------------------------- load

def attach_service(routes: list[RouteResult], params=None) -> None:
    """Service, demand and benefit-cost estimates (deterministic for a given plan and service plan)."""
    for r in routes:
        try:
            r.service = evaluate_service(r, params)
        except Exception as e:  # noqa: BLE001 - service estimates are optional; never block a plan
            log.exception("service model failed for %s: %s", r.key, e)


def load_plan(request_id: int) -> PlanResult | None:
    """Rebuild a stored plan; simulation summaries come fresh from the continuous aggregate."""
    with db.connection() as conn:
        req = conn.execute("SELECT * FROM corridor_requests WHERE id = %s", (request_id,)).fetchone()
        if not req:
            return None
        rows = conn.execute("SELECT * FROM routes WHERE request_id = %s ORDER BY rank", (request_id,)).fetchall()
        matches = conn.execute(
            "SELECT m.route_id, m.details FROM route_funding_matches m JOIN routes r ON r.id = m.route_id "
            "WHERE r.request_id = %s", (request_id,)).fetchall()
    sims = summarize_from_db([r["id"] for r in rows])
    by_route: dict[int, list[FundingMatch]] = {}
    for m in matches:
        by_route.setdefault(m["route_id"], []).append(FundingMatch(**m["details"]))
    routes = [
        RouteResult(id=r["id"], rank=r["rank"], key=r["strategy"], label=r["label"],
                    description=r["strategy_description"] or "", geometry=r["geojson"],
                    stats=RouteStats(**r["stats"]), simulation=sims[r["id"]],
                    funding=sorted(by_route.get(r["id"], []), key=lambda m: -m.fit_score))
        for r in rows
    ]
    attach_service(routes)
    runs = routes[0].simulation.runs if routes else 0
    return PlanResult(model_version=MODEL_VERSION, request_id=request_id, origin=get_city(req["origin_city_id"]),
                      destination=get_city(req["dest_city_id"]), routes=routes, assumptions=assumptions(runs),
                      data_sources=load_grid().meta["sources"],
                      created_at=req["created_at"].isoformat(timespec="seconds"), cached=True)



# ---------------------------------------------------------------- demo pairs + cache

# (origin, destination) by city name. Precomputed by scripts/precompute_demo.py into Tiger and
# into committed JSON (data/demo_cache/) that serves the demo even when the DB is unreachable.
DEMO_PAIRS = [("New York City", "Chicago"), ("Albany", "Buffalo"), ("Albany", "New York City"),
              ("Syracuse", "Rochester")]
DEMO_DIR = DATA_DIR / "demo_cache"


def _slug(name: str) -> str:
    return name.lower().replace(" ", "_")


def demo_cache_path(origin: City, dest: City):
    return DEMO_DIR / f"{_slug(origin.name)}__{_slug(dest.name)}.json"


def save_demo_cache(plan: PlanResult) -> None:
    DEMO_DIR.mkdir(parents=True, exist_ok=True)
    demo_cache_path(plan.origin, plan.destination).write_text(plan.model_dump_json(indent=1), encoding="utf-8")


def load_demo_cache(origin: City, dest: City) -> PlanResult | None:
    p = demo_cache_path(origin, dest)
    if not p.exists():
        return None
    plan = PlanResult.model_validate_json(p.read_text(encoding="utf-8"))
    if plan.model_version != MODEL_VERSION:
        return None  # stale cache from an older model; recompute instead
    return plan.model_copy(update={"cached": True})


def find_demo_cache_by_request(request_id: int) -> PlanResult | None:
    for p in DEMO_DIR.glob("*.json"):
        if p.name.endswith(".proposal.json"):
            continue  # cached proposal drafts live alongside the plans
        plan = PlanResult.model_validate_json(p.read_text(encoding="utf-8"))
        if plan.request_id == request_id:
            return plan.model_copy(update={"cached": True})
    return None


def find_latest_plan(origin_id: int, dest_id: int) -> int | None:
    with db.connection() as conn:
        row = conn.execute(
            "SELECT r.id FROM corridor_requests r WHERE r.origin_city_id = %s AND r.dest_city_id = %s "
            "AND r.params->>'model_version' = %s "
            "AND EXISTS (SELECT 1 FROM routes WHERE request_id = r.id) ORDER BY r.created_at DESC LIMIT 1",
            (origin_id, dest_id, MODEL_VERSION)).fetchone()
    return row["id"] if row else None


def delete_plans(origin_id: int, dest_id: int) -> int:
    """Remove stored plans (and their simulation runs) for a pair. Returns the number of requests deleted."""
    with db.connection() as conn, conn.transaction():
        reqs = [r["id"] for r in conn.execute(
            "SELECT id FROM corridor_requests WHERE origin_city_id = %s AND dest_city_id = %s",
            (origin_id, dest_id)).fetchall()]
        if reqs:
            conn.execute("DELETE FROM simulation_runs WHERE route_id IN "
                         "(SELECT id FROM routes WHERE request_id = ANY(%s))", (reqs,))
            conn.execute("DELETE FROM corridor_requests WHERE id = ANY(%s)", (reqs,))
    return len(reqs)


# ---------------------------------------------------------------- proposal cache

def _proposal_cache_path(plan: PlanResult):
    return DEMO_DIR / f"{_slug(plan.origin.name)}__{_slug(plan.destination.name)}.proposal.json"


def load_proposal(plan: PlanResult) -> dict | None:
    """Cached Gemini proposal for this plan: Tiger first, then the committed demo JSON."""
    if plan.request_id is not None:
        try:
            with db.connection() as conn:
                row = conn.execute("SELECT markdown, number_check FROM proposals WHERE request_id = %s",
                                   (plan.request_id,)).fetchone()
            if row:
                return {"markdown": row["markdown"], "number_check": row["number_check"]}
        except db.DBUnavailable:
            pass
    path = _proposal_cache_path(plan)
    if path.exists():
        data = json.loads(path.read_text(encoding="utf-8"))
        if data.get("request_id") == plan.request_id:
            return {"markdown": data["markdown"], "number_check": data["number_check"]}
    return None


def save_proposal(plan: PlanResult, result: dict) -> None:
    if plan.request_id is not None:
        try:
            with db.connection() as conn:
                conn.execute(
                    "INSERT INTO proposals (request_id, markdown, number_check) VALUES (%s, %s, %s) "
                    "ON CONFLICT (request_id) DO UPDATE SET markdown = EXCLUDED.markdown, "
                    "number_check = EXCLUDED.number_check, created_at = now()",
                    (plan.request_id, result["markdown"], Jsonb(result["number_check"])))
        except db.DBUnavailable:
            log.warning("proposal not stored (db unavailable)")
    pair = (plan.origin.name, plan.destination.name)
    if pair in DEMO_PAIRS:
        _proposal_cache_path(plan).write_text(json.dumps(
            {"request_id": plan.request_id, "markdown": result["markdown"], "number_check": result["number_check"]},
            indent=1, ensure_ascii=False), encoding="utf-8")
