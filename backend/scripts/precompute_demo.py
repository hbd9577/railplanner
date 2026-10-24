"""Precompute the demo city pairs into Tiger and refresh the committed JSON demo cache.

    python -m scripts.precompute_demo            # replace stored plans for the demo pairs
    python -m scripts.precompute_demo --keep     # add a new plan without deleting older ones
"""
from __future__ import annotations

import argparse
import time

from app import db
from app.planner import DEMO_PAIRS, delete_plans, list_cities, run_plan, save_demo_cache


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--keep", action="store_true", help="keep older stored plans for the pairs")
    ap.add_argument("--runs", type=int, default=None)
    args = ap.parse_args()

    ids = {c.name: c.id for c in list_cities()}
    for o, d in DEMO_PAIRS:
        if not args.keep:
            n = delete_plans(ids[o], ids[d])
            if n:
                print(f"  removed {n} older plan(s) for {o} -> {d}")
        t0 = time.perf_counter()
        plan = run_plan(ids[o], ids[d], runs=args.runs)
        sources = {r.simulation.source for r in plan.routes}
        if plan.request_id is None or sources != {"tiger_cagg"}:
            raise SystemExit(f"{o} -> {d}: not persisted to Tiger (sources={sources}); check DATABASE_URL")
        save_demo_cache(plan)
        p50s = ", ".join(f"{r.key} ${r.simulation.cost.p50 / 1e9:.1f}B" for r in plan.routes)
        print(f"{o} -> {d}: request {plan.request_id} in {time.perf_counter() - t0:.1f}s  ({p50s})")
    db.close_pool()


if __name__ == "__main__":
    main()
