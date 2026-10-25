"""Rule-based matching of a route to federal funding programs (data/funding_programs.json).

Inputs: project type (upgrade if >= 60% on existing ROW, else new alignment), P50 cost,
stations served (NEC eligibility), and program award ranges. Each match gets a 0-1 fit score,
a plain-language rationale built only from these computed values, and cost-share math at the
P50 cost: federal = min(match % x P50, top of RailPlanner's assumed award range).
"""
from __future__ import annotations

import json
from functools import lru_cache

from .config import DATA_DIR
from .models import CostShare, FundingMatch, RouteStats

UPGRADE_THRESHOLD_PCT = 60.0
NEC_CITIES = {"New York City"}
NEC_SHARE_ASSUMPTION = 0.05  # share of cost assumed to be NEC-adjacent work (e.g. Penn Station approach)
NEC_NYC_PHL_MILES = 91  # routes via Philadelphia use the NEC main line from New York


@lru_cache
def _city_states() -> dict[str, str]:
    return {c["name"]: c["state"] for c in json.loads((DATA_DIR / "cities.json").read_text(encoding="utf-8"))}


@lru_cache
def load_programs() -> list[dict]:
    return json.loads((DATA_DIR / "funding_programs.json").read_text(encoding="utf-8"))["programs"]


def usd(x: float) -> str:
    """Compact money format shared with the proposal payload so the number-check sees identical strings."""
    if x >= 1e9:
        return f"${x / 1e9:.1f}B"
    if x >= 1e6:
        return f"${x / 1e6:.0f}M"
    return f"${x / 1e3:.0f}K"


def _share(p50: float, federal: float, loan: float = 0.0) -> CostShare:
    federal = max(0.0, min(federal, p50))
    return CostShare(basis_cost_usd=round(p50, -5), federal_usd=round(federal, -5),
                     non_federal_usd=round(p50 - federal, -5),
                     federal_pct=round(100 * federal / p50, 1) if p50 else 0.0, loan_usd=round(loan, -5))


def match_route(stats: RouteStats, p50_cost: float) -> list[FundingMatch]:
    project_type = "upgrade" if stats.row_reuse_pct >= UPGRADE_THRESHOLD_PCT else "new_alignment"
    type_text = ("an upgrade of an existing rail corridor" if project_type == "upgrade"
                 else "a largely new alignment")
    touches_nec = bool(NEC_CITIES & set(stats.stations))
    on_nec_main = touches_nec and "Philadelphia" in stats.stations
    nec_share = min(1.0, NEC_NYC_PHL_MILES / stats.length_miles) if on_nec_main else NEC_SHARE_ASSUMPTION
    states = sorted({_city_states()[c] for c in stats.stations if c in _city_states()})
    multi_state = (f" The route spans {len(states)} states ({', '.join(states)}), so it needs a multi-state "
                   "sponsor or interstate compact." if len(states) > 1 else "")
    out: list[FundingMatch] = []

    for p in load_programs():
        lo, hi = p["typical_award_usd"]
        match = p["federal_match_pct"] / 100
        eligible = project_type in p["eligible_project_types"]
        loan = 0.0

        if p["id"] == "fsp_national":
            fit = 0.9 if p50_cost >= 1e9 else 0.65
            federal = min(match * p50_cost, hi)
            gap = "" if federal >= match * p50_cost else (
                f" The P50 cost ({usd(p50_cost)}) exceeds RailPlanner's assumed largest single award ({usd(hi)}), "
                "so the project would likely need to be phased across several awards.")
            why = (f"Core federal capital program for intercity passenger rail; this route is {type_text}. "
                   f"Up to {p['federal_match_pct']}% federal share.{gap}{multi_state}")
        elif p["id"] == "fsp_nec":
            eligible = eligible and touches_nec
            fit = 0.35 if eligible else 0.0
            fit = 0.6 if on_nec_main else fit
            federal = min(match * nec_share * p50_cost, hi) if eligible else 0.0
            if on_nec_main:
                why = (f"The route uses the Northeast Corridor main line between New York and Philadelphia "
                       f"({NEC_NYC_PHL_MILES} miles, about {nec_share:.0%} of the route), which is eligible for NEC funds.")
            elif eligible:
                why = ("Route reaches New York City, so NEC-adjacent elements (assumed about "
                       f"{NEC_SHARE_ASSUMPTION:.0%} of cost) could compete for NEC funds.")
            else:
                why = "Not eligible: the route does not use the Northeast Corridor main line."
        elif p["id"] == "crisi":
            fit = 0.8 if project_type == "upgrade" else 0.55
            federal = min(match * p50_cost, hi)
            why = (f"Fits {'well' if project_type == 'upgrade' else 'partially'}: CRISI funds safety, capacity and "
                   f"grade-crossing work on existing lines. RailPlanner assumes awards up to about {usd(hi)}, so it suits "
                   "discrete packages such as grade separations or sidings.")
        elif p["id"] == "build":
            fit = 0.45
            federal = min(match * p50_cost, hi)
            why = (f"Capped at {usd(hi)} per award (FY2026 notice): useful for a station or grade separation "
                   f"(the route serves {len(stats.stations)} stations), not the core build.")
        elif p["id"] == "rrif":
            fit = 0.7 if project_type == "upgrade" else 0.6
            federal = 0.0
            loan = min(0.2 * p50_cost, hi)
            why = (f"Low-interest federal loan that could finance the non-federal match "
                   f"(20% of P50 is {usd(0.2 * p50_cost)}). Requires a repayment source such as "
                   "state appropriations or farebox revenue.")
        elif p["id"] == "corridor_id":
            fit = 0.95
            federal = float(lo)
            why = (f"Planning entry point: Step 1 scoping is federally funded (about {usd(lo)}) and "
                   "places the corridor in the pipeline FRA uses to prioritize FSP-National capital awards."
                   + multi_state)
        else:
            continue

        if not eligible:
            fit, federal, loan = 0.0, 0.0, 0.0
        out.append(FundingMatch(
            program_id=p["id"], program_name=p["name"], agency=p["agency"], kind=p["kind"],
            eligible=eligible, fit_score=round(fit, 2), rationale=why,
            cost_share=_share(p50_cost, federal, loan),
        ))
    return sorted(out, key=lambda m: -m.fit_score)
