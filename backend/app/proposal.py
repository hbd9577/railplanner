"""Gemini-drafted corridor proposal and Q&A, constrained to the computed results.

The LLM never invents numbers:
  1. build_payload() turns a PlanResult into a JSON payload whose figures are pre-formatted
     strings ("$25.2B", "17.8 years", ...). Gemini is told to copy figures verbatim from it.
  2. Gemini returns the required sections as JSON (structured output); we assemble the markdown
     ourselves, so headings and the "Illustrative estimates" disclaimer are always present.
  3. number_check() extracts every number in the output and verifies each one appears in the
     payload. On failure Gemini gets one retry listing the offending figures; if that also fails
     (or Gemini is unavailable) a deterministic template proposal is returned instead.
"""
from __future__ import annotations

import json
import logging
import math
import re
import time
from datetime import datetime, timezone

from pydantic import BaseModel

from .config import get_settings
from .funding import load_programs
from .models import PlanResult, RouteResult

log = logging.getLogger(__name__)

FALLBACK_MODELS = ["gemini-3.5-flash", "gemini-flash-latest"]
DISCLAIMER = (
    "Illustrative estimates: costs, schedules and funding figures in this draft come from an "
    "uncalibrated planning model and approximate program parameters. They are not budgets or "
    "engineering estimates."
)
SECTIONS = [
    ("executive_summary", "Executive Summary"),
    ("service_assumptions", "Service Assumptions"),
    ("alternatives", "Alternatives and Tradeoffs"),
    ("recommendation", "Recommendation Under the Stated Priorities"),
    ("cost_and_schedule", "Cost, Schedule and Uncertainty"),
    ("funding_strategy", "Funding Considerations"),
    ("risks", "Risks and Information Gaps"),
    ("next_steps", "Next Steps"),
]


class Priority(BaseModel):
    label: str
    share_pct: int


class Scenario(BaseModel):
    """The user's active scenario, sent by the client so drafts and answers reflect it."""
    priorities: list[Priority] = []
    ranking: list[str] = []  # alternative names, first = leads under these priorities
    close_call: bool = False  # top two within a few points
    excluded_priorities: list[str] = []  # left out because a value is missing
    selected: str | None = None
    is_default: bool = True
    service: dict | None = None  # {round_trips, max_mph_existing, max_mph_new}; None = default plan


def apply_service_plan(plan: PlanResult, scenario: Scenario | None) -> PlanResult:
    """Re-run service estimates for the scenario's service plan so drafts and answers match the screen."""
    if scenario is None or not scenario.service:
        return plan
    from .service import ServiceParams, evaluate  # local import: service imports routing/scoring only

    params = ServiceParams(**scenario.service)
    routes = [r.model_copy(update={"service": evaluate(r, params)}) for r in plan.routes]
    return plan.model_copy(update={"routes": routes})


SERVICE_ASSUMPTIONS = [
    "the service plan is a screening assumption (daily round trips and top speeds as stated), not a timetable",
    "a station is assumed at each of RailPlanner's cities within 5 km of an alignment; real station sites are not chosen",
    "running times come from top speeds, an average-speed factor and stop penalties, not a train performance simulation",
    "trains on existing rail corridors would share track with freight under agreements that do not yet exist",
]


class GeminiUnavailable(RuntimeError):
    pass


# ---------------------------------------------------------------- formatting (shared with payload)

def usd(x: float) -> str:
    if x >= 1e9:
        return f"${x / 1e9:.1f}B"
    if x >= 1e6:
        return f"${x / 1e6:.0f}M"
    return f"${x / 1e3:.0f}K"


def years(months: float) -> str:
    return f"{months / 12:.1f} years"


def people(n: float) -> str:
    return f"{n / 1e6:.2f} million" if n >= 1e6 else f"{n / 1e3:.0f} thousand"


# ---------------------------------------------------------------- payload

# What the model does not cover; included in every payload so drafts and answers cannot imply it.
NOT_MODELED = [
    "a detailed timetable, time-of-day pattern and stopping pattern (every train is assumed to stop everywhere)",
    "on-time performance and reliability on shared freight track",
    "track capacity, freight conflicts, train paths and access agreements with host railroads",
    "bus competition, and air competition beyond a simple airport-time comparison",
    "electrification, maintenance facilities and mid-life overhauls",
    "injury and property-damage crash benefits, criteria air pollutants and wider economic effects",
]

PRELIMINARY = ("travel times, ridership, fare revenue, operating cost and subsidy, fleet size, benefit-cost ratio, "
               "CO2 and fatalities avoided are preliminary model estimates with wide ranges; ridership is calibrated "
               "to FY2024 Amtrak station ridership but its fit error is large")


def _route_payload(r: RouteResult) -> dict:
    s, c, d = r.stats, r.simulation.cost, r.simulation.duration
    eligible = [m for m in r.funding if m.eligible and m.fit_score > 0]
    return {
        "number": r.rank,
        "name": r.label,
        "approach": r.description,
        "length": f"{s.length_miles:.0f} miles",
        "share_on_existing_rail_corridors": f"{s.row_reuse_pct:.1f}%",
        "new_track_length": f"{s.miles_new:.0f} miles",
        "residents_near_alignment": people(s.population_served),
        "residents_near_stations": people(s.pop_near_stations),
        "stations_in_route_order": s.stations,
        "station_count": len(s.stations),
        "new_track_in_flagged_areas": f"{s.env_miles_new:.0f} miles",
        "environmental_flag_entries": s.env_flag_count,
        "river_crossings": s.river_crossings,
        "capital_cost": {"low_P10": usd(c.p10), "median_P50": usd(c.p50), "high_P90": usd(c.p90)},
        "time_to_opening": {"low_P10": years(d.p10), "median_P50": years(d.p50), "high_P90": years(d.p90)},
        "service": _service_payload(r),
        "funding_matches": [
            {
                "program": m.program_name,
                "agency": m.agency,
                "type": m.kind,
                "fit_score": f"{m.fit_score:.2f}",
                "federal_amount": usd(m.cost_share.federal_usd) if m.kind != "loan" else None,
                "loan_amount": usd(m.cost_share.loan_usd) if m.kind == "loan" else None,
                "federal_share_of_median_cost": f"{m.cost_share.federal_pct:.1f}%" if m.kind == "grant" else None,
                "rationale": m.rationale,
            }
            for m in eligible
        ],
    }


def _program_facts() -> dict:
    return {p["name"]: p.get("guide", {}) for p in load_programs()}


def _service_payload(r: RouteResult) -> dict | None:
    sv = r.service
    if sv is None or not sv.available:
        return None

    def rng(x, fmt):
        return {"low_P10": fmt(x.p10), "median_P50": fmt(x.p50), "high_P90": fmt(x.p90)}

    def money(v):
        return ("an operating surplus of " + usd(-v)) if v < 0 else usd(v)

    co2 = sv.co2_tonnes.p50
    return {
        "service_plan": f"{sv.round_trips} daily round trips, top speed {sv.max_mph_existing:.0f} mph on existing rail "
                        f"and {sv.max_mph_new:.0f} mph on new track, every train stops at every station",
        "end_to_end_train_time": f"{sv.end_to_end_min / 60:.1f} hours",
        "end_to_end_driving_time": f"{sv.end_to_end_car_min / 60:.1f} hours",
        "station_pairs_where_rail_door_to_door_beats_driving": f"{sv.share_pairs_faster_than_car * 100:.0f}%",
        "annual_riders": rng(sv.riders, people),
        "annual_fare_revenue": rng(sv.revenue, usd),
        "annual_operating_cost": rng(sv.opex, usd),
        "annual_operating_subsidy_median": money(sv.subsidy.p50),
        "trainsets_needed": sv.trainsets,
        "benefit_cost_ratio_at_7_percent": rng(sv.bcr, lambda v: f"{v:.2f}"),
        "co2_change_per_year_median": (f"{co2:,.0f} tonnes avoided" if co2 >= 0 else f"{-co2:,.0f} tonnes added"),
        "share_on_freight_owned_track": f"{sv.freight_share * 100:.0f}%",
    }


def build_payload(plan: PlanResult, scenario: Scenario | None = None) -> dict:
    routes = plan.routes
    leaders = {
        "lowest_median_cost": min(routes, key=lambda r: r.simulation.cost.p50).label,
        "shortest_median_time_to_opening": min(routes, key=lambda r: r.simulation.duration.p50).label,
        "most_residents_near_stations": max(routes, key=lambda r: r.stats.pop_near_stations).label,
        "most_stations": max(routes, key=lambda r: len(r.stats.stations)).label,
        "shortest_alignment": min(routes, key=lambda r: r.stats.length_miles).label,
        "highest_share_on_existing_rail_corridors": max(routes, key=lambda r: r.stats.row_reuse_pct).label,
    }
    first = routes[0].stats if routes else None
    return {
        "corridor": f"{plan.origin.name}, {plan.origin.state} to {plan.destination.name}, {plan.destination.state}",
        "simulation_runs_per_alternative": routes[0].simulation.runs if routes else 0,
        "definitions": {
            "residents_near_alignment": f"residents within {first.buffer_miles:.0f} miles of the line" if first else None,
            "residents_near_stations": (f"residents within {first.station_catchment_km:.0f} km of any station, "
                                        "counted once") if first else None,
            "existing_rail_corridors": ("share of the path on existing rail right-of-way; this does not establish "
                                        "ownership access, spare capacity or operating permission"),
            "population_is_not_ridership": "population figures are not passenger forecasts",
        },
        "population_buffer": f"{first.buffer_miles:.0f} miles" if first else None,
        "alternatives": [_route_payload(r) for r in routes],
        "leaders_on_single_measures": leaders,
        "service_assumptions": SERVICE_ASSUMPTIONS,
        "preliminary_estimates": PRELIMINARY,
        "not_modeled": NOT_MODELED,
        "assumptions_and_limitations": plan.assumptions,
        "funding_program_status": {
            name: {"status": g.get("status"), "match": g.get("match"), "next_step": g.get("next_step")}
            for name, g in _program_facts().items() if g
        },
        "scenario": _scenario_payload(scenario),
    }


def _scenario_payload(scenario: Scenario | None) -> dict:
    if scenario is None or not scenario.ranking:
        return {"note": "no priorities were supplied; do not rank the alternatives overall"}
    return {
        "priorities_and_share_of_weight": {p.label: f"{p.share_pct}%" for p in scenario.priorities if p.share_pct > 0},
        "ranking_under_these_priorities": scenario.ranking,
        "leads_under_these_priorities": scenario.ranking[0],
        "top_two_are_close": scenario.close_call,
        "priorities_left_out_for_missing_data": scenario.excluded_priorities,
        "alternative_the_user_selected": scenario.selected,
        "meaning": ("the ranking is a weighted comparison of the modeled measures only; it is not a benefit-cost "
                    "ratio and does not show feasibility, eligibility or that the service would be useful"),
    }


# ---------------------------------------------------------------- number check

# a figure with its optional $ prefix and B/M/K/% suffix; values compare unit-agnostically
_NUM = re.compile(r"(?<![\w.])\$?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:[BMK%](?![A-Za-z]))?")
_LIST_MARKER = re.compile(r"^\s*(?:\d+[.)]|[-*])\s+", re.M)


def _numbers(text: str) -> list[tuple[str, float]]:
    out = []
    for m in _NUM.finditer(text):
        raw = m.group(0)
        try:
            out.append((raw, float(raw.rstrip("BMK%").replace("$", "").replace(",", ""))))
        except ValueError:
            continue
    return out


def number_check(text: str, payload: dict) -> dict:
    """Every number in `text` must also appear (as the same value) somewhere in `payload`."""
    allowed = {v for _, v in _numbers(json.dumps(payload, ensure_ascii=False))}
    body = _LIST_MARKER.sub("", text)  # ordered-list markers are formatting, not figures
    unmatched = []
    for raw, v in _numbers(body):
        if not any(math.isclose(v, a, rel_tol=1e-9, abs_tol=1e-9) for a in allowed):
            if raw not in unmatched:
                unmatched.append(raw)
    return {"passed": not unmatched, "unmatched": unmatched}


# ---------------------------------------------------------------- Gemini

class ProposalSections(BaseModel):
    title: str
    executive_summary: str
    service_assumptions: str
    alternatives: str
    recommendation: str
    cost_and_schedule: str
    funding_strategy: str
    risks: str
    next_steps: str


SYSTEM_PROMPT = """You draft concise passenger-rail corridor proposals for state DOT planners.
You receive a JSON payload of computed results. Rules, strictly:
- Use ONLY figures that appear in the payload, copied exactly as written there (e.g. "$25.2B",
  "17.8 years", "954 miles", "99.7%"). Do not round, convert units, add, subtract, compute
  differences, percentages or ratios, or introduce any other number, year or count.
- If a comparison needs a number that is not in the payload, describe it in words instead.
- Name alternatives by their name (e.g. "the Pennsylvania corridor upgrade"); you may use
  "Alternative 1/2/3" since those numbers are in the payload.
- Costs are illustrative estimates, not budgets. Say so where you discuss cost.
- Recommendation: if the scenario gives a ranking, state which alternative leads under the stated
  priorities, name those priorities, and say it is conditional on them (and a close call if the top two
  are close). Never call it "best" or imply feasibility, eligibility, ridership or value for money. If no
  ranking is given, describe tradeoffs only.
- Service Assumptions: state the assumed service plan and that it is not a timetable; list the service assumptions.
- Ridership, revenue, subsidy, benefit-cost ratio and CO2 are preliminary estimates: always give the P10 to P90
  range with the median, and say the ridership fit error is large.
- Cost, Schedule and Uncertainty: give P10, median (P50) and P90 and explain that P10 to P90 is the
  middle 80% of modeled outcomes under the model's own assumptions, not a guarantee.
- Funding Considerations: distinguish screening fit, program limits, assumed amounts and loans; nothing
  is secured; never add program amounts together; mention each relevant program's status.
- Population figures are not ridership. Being on an existing rail corridor does not mean access,
  capacity or permission to operate. Never imply anything listed under not_modeled was analyzed;
  name those gaps in Risks and Next Steps.
- Explain differences only through the measures given (for example more new track or more mountainous
  miles); do not claim causes the model does not represent.
- Never mention JSON, the payload, or field names; write "median (P50)", "P10", "P90" in prose.
- Plain, professional prose for a planning audience. No marketing language, no code formatting.
- Each section is 1-3 short paragraphs of markdown (bullets allowed in Risks and Next Steps).
  Do not include section headings; they are added for you."""


def _client():
    key = get_settings().gemini_api_key
    if not key:
        raise GeminiUnavailable("GEMINI_API_KEY is not set")
    from google import genai

    return genai.Client(api_key=key)


def _models() -> list[str]:
    configured = get_settings().gemini_model
    return [configured] + [m for m in FALLBACK_MODELS if m != configured]


def _generate(contents: str, system: str, schema=None, temperature: float = 0.3) -> str:
    from google.genai import types

    client = _client()
    config = types.GenerateContentConfig(
        thinking_config=types.ThinkingConfig(thinking_level="low"),  # fast enough for a live demo
        system_instruction=system,
        temperature=temperature,
        response_mime_type="application/json" if schema else "text/plain",
        response_schema=schema,
    )
    last: Exception | None = None
    for model in _models():
        for attempt in range(2):  # one quick retry for transient overload (503/429)
            try:
                resp = client.models.generate_content(model=model, contents=contents, config=config)
                if resp.text:
                    return resp.text
                last = RuntimeError(f"{model} returned no text")
                break
            except Exception as e:  # noqa: BLE001 - retry/try the next model, then give up
                log.warning("gemini %s failed: %s", model, str(e)[:200])
                last = e
                transient = any(code in str(e) for code in ("503", "429", "UNAVAILABLE", "RESOURCE_EXHAUSTED"))
                if not transient:
                    break
                time.sleep(2)
    raise GeminiUnavailable(str(last))


def _assemble(sections: ProposalSections) -> str:
    parts = [f"# {sections.title.strip()}", f"> **{DISCLAIMER}**"]
    for key, heading in SECTIONS:
        parts.append(f"## {heading}\n\n{getattr(sections, key).strip()}")
    return "\n\n".join(parts) + "\n"


def record_and_sources(plan: PlanResult, scenario: Scenario | None, model_version: str) -> str:
    """Deterministic appendix (not written by the language model, so outside the number check)."""
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    lines = ["", "## Scenario Record", ""]
    lines.append(f"- Corridor: {plan.origin.name}, {plan.origin.state} to {plan.destination.name}, {plan.destination.state}")
    if scenario and scenario.priorities:
        weights = ", ".join(f"{p.label} {p.share_pct}%" for p in scenario.priorities if p.share_pct > 0)
        lines.append(f"- Priorities (share of weight): {weights or 'none'}")
        lines.append(f"- Ranking under these priorities: {', '.join(scenario.ranking)}")
        if scenario.excluded_priorities:
            lines.append(f"- Left out for missing data: {', '.join(scenario.excluded_priorities)}")
    else:
        lines.append("- Priorities: none supplied (no overall ranking)")
    if scenario and scenario.selected:
        lines.append(f"- Selected alternative: {scenario.selected}")
    sv = next((r.service for r in plan.routes if r.service and r.service.available), None)
    if sv:
        lines.append(f"- Service plan: {sv.round_trips} daily round trips, top speed {sv.max_mph_existing:.0f} mph on "
                     f"existing rail and {sv.max_mph_new:.0f} mph on new track")
    runs = plan.routes[0].simulation.runs if plan.routes else 0
    lines.append(f"- Plan {plan.request_id}, model version {model_version or 'unknown'}, {runs:,} simulations per alternative")
    lines.append(f"- Draft generated: {now}")
    lines += ["", "## Sources", ""]
    for key, v in plan.data_sources.items():
        flag = "" if v.get("flag") == "real" else f" ({v.get('flag')})"
        lines.append(f"- {key.replace('_', ' ').capitalize()}: {v.get('source')}{flag}")
    for name, g in _program_facts().items():
        if g.get("source_url"):
            lines.append(f"- {name}: [{g.get('source_label')}]({g['source_url']}), checked {g.get('verified_on')}")
    lines += ["", "_Draft for internal review. Verify figures and program details before sharing externally._"]
    return "\n".join(lines) + "\n"


def template_proposal(payload: dict) -> str:
    """Deterministic fallback built only from payload strings (used when Gemini is unavailable)."""
    alts = payload["alternatives"]
    lead = payload["leaders_on_single_measures"]
    scen = payload.get("scenario", {})
    lines = [f"# Corridor proposal: {payload['corridor']}", f"> **{DISCLAIMER}**", "## Executive Summary", ""]
    claims = {}
    for key, text in (("lowest_median_cost", "the lowest median cost"),
                      ("shortest_median_time_to_opening", "the shortest median time to opening"),
                      ("most_residents_near_stations", "the most residents near its stations")):
        claims.setdefault(lead[key], []).append(text)
    summary = " ".join(
        f"The {name} has {', '.join(c[:-1]) + ' and ' + c[-1] if len(c) > 1 else c[0]}." for name, c in claims.items()
    )
    lines.append(f"{len(alts)} alternatives were evaluated for this corridor. {summary}")
    lines += ["", "## Service Assumptions", ""]
    lines += [f"- {x[0].upper() + x[1:]}." for x in payload["service_assumptions"]]
    lines += ["", "## Alternatives and Tradeoffs", ""]
    for a in alts:
        lines.append(
            f"- **Alternative {a['number']}: {a['name']}**: {a['length']}, {a['share_on_existing_rail_corridors']} on "
            f"existing rail corridors, {a['residents_near_stations']} residents near its stations. {a['approach']}"
        )
        sv = a.get("service")
        if sv:
            rd = sv["annual_riders"]
            lines.append(
                f"  Modeled service ({sv['service_plan']}): end-to-end train time {sv['end_to_end_train_time']} "
                f"against {sv['end_to_end_driving_time']} by car; {rd['median_P50']} riders a year "
                f"(P10 {rd['low_P10']}, P90 {rd['high_P90']}); median operating subsidy {sv['annual_operating_subsidy_median']}."
            )
    lines += ["", "## Recommendation Under the Stated Priorities", ""]
    if "leads_under_these_priorities" in scen:
        pri = ", ".join(scen["priorities_and_share_of_weight"]) or "no weighted priorities"
        close = " The top two are close, so treat this as a tie." if scen["top_two_are_close"] else ""
        lines.append(f"Under the stated priorities ({pri}), the {scen['leads_under_these_priorities']} leads.{close} "
                     "This is conditional on those priorities and the modeled measures; it does not show "
                     "feasibility, eligibility or ridership.")
    else:
        lines.append("No priorities were supplied, so the alternatives are not ranked overall.")
    lines += ["", "## Cost, Schedule and Uncertainty", ""]
    for a in alts:
        c, t = a["capital_cost"], a["time_to_opening"]
        lines.append(
            f"- **{a['name']}**: capital cost {c['low_P10']} to {c['high_P90']} (median {c['median_P50']}); "
            f"time to opening {t['low_P10']} to {t['high_P90']} (median {t['median_P50']})."
        )
    lines.append("P10 to P90 is the middle 80% of modeled outcomes under the model's own assumptions; it is "
                 "not a guarantee.")
    lines += ["", "## Funding Considerations", ""]
    lines.append("Nothing is secured. Fit is a screening judgment, and program amounts cannot simply be added.")
    top = next((a for a in alts if a["name"] == lead["lowest_median_cost"]), alts[0])
    for m in top["funding_matches"][:4]:
        lines.append(f"- **{m['program']}** ({m['agency']}): {m['rationale']}")
    lines += ["", "## Risks and Information Gaps", "", "- Cost benchmarks are uncalibrated; ranges reflect modeled uncertainty only.",
              "- Not yet modeled: " + "; ".join(payload["not_modeled"]) + ".",
              "- Environmental flags and floodplain layers are screening-level and need field review.",
              "", "## Next Steps", "", "- Enter the corridor into FRA's Corridor ID program.",
              "- Commission a service development plan and calibrated cost estimate."]
    return "\n".join(lines) + "\n"


def generate_proposal(plan: PlanResult, scenario: Scenario | None = None, model_version: str = "") -> dict:
    """Returns {markdown, number_check, source}; source is "gemini" or "template".

    The number check covers the drafted text; the scenario record and sources appendix is appended
    afterwards by code."""
    plan = apply_service_plan(plan, scenario)
    payload = build_payload(plan, scenario)
    appendix = record_and_sources(plan, scenario, model_version)
    prompt = "Draft the proposal from this payload.\n\n" + json.dumps(payload, indent=1, ensure_ascii=False)
    try:
        for attempt in range(2):
            raw = _generate(prompt, SYSTEM_PROMPT, schema=ProposalSections)
            markdown = _assemble(ProposalSections.model_validate_json(raw))
            check = number_check(markdown, payload)
            if check["passed"]:
                return {"markdown": markdown + appendix, "number_check": check, "source": "gemini"}
            log.warning("proposal number check failed (attempt %d): %s", attempt + 1, check["unmatched"])
            prompt += (
                "\n\nYour previous draft used figures that are not in the payload: "
                + ", ".join(check["unmatched"])
                + ". Rewrite without them, using only payload figures verbatim or words."
            )
    except (GeminiUnavailable, ValueError) as e:
        log.warning("gemini proposal unavailable, using template: %s", e)
    markdown = template_proposal(payload)
    return {"markdown": markdown + appendix, "number_check": number_check(markdown, payload), "source": "template"}


# ---------------------------------------------------------------- Q&A

QA_PROMPT = """You answer questions about a passenger-rail corridor analysis using ONLY the JSON
payload provided. Rules:
- Copy any figure exactly as written in the payload; never compute, round or introduce other numbers.
- Start with a direct answer in one or two sentences. Then a line "Supporting measures:" with 1-4
  bullets naming the measure and the alternatives' values from the analysis.
- Explain differences only through measures in the analysis (for example more new track, more
  mountainous miles, more stations). Do not state causes the model does not represent; if the cause
  is not modeled, say so.
- Anything not in the analysis must be labeled "General context (not from this analysis):" and must
  contain no figures. If the question needs something under not_modeled, say it is not modeled.
- Population is not ridership; existing rail corridors do not imply access or capacity; costs are
  illustrative estimates.
- Never mention JSON, the payload or field names, and do not use code formatting; say "the analysis".
{length}"""

QA_LENGTH = {
    False: "Keep the whole answer under 90 words.",
    True: "You may use up to 250 words, adding a short 'Detail' paragraph after the bullets.",
}


def ask(question: str, plan: PlanResult, scenario: Scenario | None = None, detail: bool = False) -> dict:
    """Returns {answer, number_check}."""
    plan = apply_service_plan(plan, scenario)
    payload = build_payload(plan, scenario)
    system = QA_PROMPT.replace("{length}", QA_LENGTH[detail])
    prompt = f"Payload:\n{json.dumps(payload, indent=1, ensure_ascii=False)}\n\nQuestion: {question.strip()}"
    answer = _generate(prompt, system, temperature=0.2).strip()
    check = number_check(answer, payload)
    if not check["passed"]:
        log.warning("Q&A number check failed: %s", check["unmatched"])
        retry = prompt + (
            "\n\nYour previous answer used figures not in the payload: " + ", ".join(check["unmatched"])
            + ". Answer again using only payload figures verbatim, or words."
        )
        answer = _generate(retry, system, temperature=0.1).strip()
        check = number_check(answer, payload)
    return {"answer": answer, "number_check": check}
