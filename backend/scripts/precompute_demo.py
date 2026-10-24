"""Precompute the demo city pairs into Tiger and refresh the committed JSON demo cache.

    python -m scripts.precompute_demo            # replace stored plans for the demo pairs
    python -m scripts.precompute_demo --keep     # add a new plan without deleting older ones
    python -m scripts.precompute_demo --proposals-only   # draft + cache Gemini proposals (run after the above)
"""
from __future__ import annotations

import argparse
import time

from app import db, proposal
from app.planner import (DEMO_PAIRS, delete_plans, find_latest_plan, list_cities, load_plan, run_plan,
                         save_demo_cache, save_proposal)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--keep", action="store_true", help="keep older stored plans for the pairs")
    ap.add_argument("--runs", type=int, default=None)
    ap.add_argument("--proposals-only", action="store_true",
                    help="keep stored plans; just (re)draft and cache Gemini proposals for them")
    args = ap.parse_args()

    ids = {c.name: c.id for c in list_cities()}
    if args.proposals_only:
        for o, d in DEMO_PAIRS:
            plan = load_plan(find_latest_plan(ids[o], ids[d]))
            t0 = time.perf_counter()
            res = proposal.generate_proposal(plan)
            if res["source"] == "gemini":
                save_proposal(plan, res)
            print(f"{o} -> {d}: proposal {res['source']} check={res['number_check']['passed']} "
                  f"in {time.perf_counter() - t0:.0f}s")
        db.close_pool()
        return
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
