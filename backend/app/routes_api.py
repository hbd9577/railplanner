"""HTTP endpoints.

POST /plan resolution order (keeps a working demo path when things fail):
    1. latest stored plan for the pair in Tiger (unless ?fresh=true)
    2. committed JSON demo cache (data/demo_cache/), when USE_DEMO_CACHE is on
    3. compute now: persists to Tiger, or summarizes in-process if the DB is unreachable
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from . import planner, proposal
from .config import DATA_DIR, get_settings
from .db import DBUnavailable
from .models import City, PlanResult

log = logging.getLogger(__name__)
router = APIRouter()


class PlanRequest(BaseModel):
    origin_id: int
    dest_id: int


class DemoPair(BaseModel):
    origin_id: int
    dest_id: int
    label: str


class AskRequest(BaseModel):
    question: str


class VoiceRequest(BaseModel):
    text: str


def _cities_by_id() -> dict[int, City]:
    return {c.id: c for c in planner.list_cities()}


@router.get("/cities", response_model=list[City])
def get_cities() -> list[City]:
    return planner.list_cities()


@router.get("/demo-pairs", response_model=list[DemoPair])
def get_demo_pairs() -> list[DemoPair]:
    by_name = {c.name: c for c in planner.list_cities()}
    return [DemoPair(origin_id=by_name[o].id, dest_id=by_name[d].id, label=f"{o} → {d}")
            for o, d in planner.DEMO_PAIRS if o in by_name and d in by_name]


@router.post("/plan", response_model=PlanResult)
def create_plan(body: PlanRequest, fresh: bool = False) -> PlanResult:
    cities = _cities_by_id()
    if body.origin_id not in cities or body.dest_id not in cities:
        raise HTTPException(404, "unknown city id")
    if body.origin_id == body.dest_id:
        raise HTTPException(400, "origin and destination must differ")
    origin, dest = cities[body.origin_id], cities[body.dest_id]

    if not fresh:
        try:
            rid = planner.find_latest_plan(origin.id, dest.id)
            if rid is not None:
                plan = planner.load_plan(rid)
                if plan is not None:
                    return plan
        except DBUnavailable as e:
            log.warning("db unavailable for plan lookup: %s", e)
        if get_settings().use_demo_cache:
            cached = planner.load_demo_cache(origin, dest)
            if cached is not None:
                return cached

    return planner.run_plan(origin.id, dest.id)


def _plan_or_404(request_id: int) -> PlanResult:
    try:
        plan = planner.load_plan(request_id)
    except DBUnavailable:
        plan = planner.find_demo_cache_by_request(request_id) if get_settings().use_demo_cache else None
    if plan is None:
        raise HTTPException(404, f"plan {request_id} not found")
    return plan


@router.get("/plan/{request_id}", response_model=PlanResult)
def get_plan(request_id: int) -> PlanResult:
    return _plan_or_404(request_id)


@router.post("/proposal/{request_id}")
def create_proposal(request_id: int, refresh: bool = False) -> dict:
    """Gemini-drafted proposal; cached per plan. Falls back to a template draft if Gemini is down."""
    plan = _plan_or_404(request_id)
    if not refresh:
        cached = planner.load_proposal(plan)
        if cached is not None:
            return {**cached, "source": "cache"}
    result = proposal.generate_proposal(plan)
    if result["source"] == "gemini":
        planner.save_proposal(plan, result)
    return result


@router.post("/ask/{request_id}")
def ask(request_id: int, body: AskRequest) -> dict:
    question = body.question.strip()
    if not question:
        raise HTTPException(400, "question is empty")
    if len(question) > 500:
        raise HTTPException(400, "question is too long (500 characters max)")
    plan = _plan_or_404(request_id)
    try:
        return proposal.ask(question, plan)
    except proposal.GeminiUnavailable as e:
        log.warning("ask unavailable: %s", e)
        raise HTTPException(503, "Q&A is temporarily unavailable (the language model is busy). Try again shortly.")


LAYERS = {"rail", "protected"}


@router.get("/layers/{name}")
def get_layer(name: str):
    """Static map overlays built by scripts/build_layers.py (existing rail, protected areas)."""
    if name not in LAYERS:
        raise HTTPException(404, "unknown layer")
    path = DATA_DIR / "processed" / "layers" / f"{name}.geojson"
    if not path.exists():
        raise HTTPException(404, "layer not built; run python -m scripts.build_layers")
    return FileResponse(path, media_type="application/geo+json", headers={"Cache-Control": "public, max-age=86400"})


# Wired up in Phase 8 (ElevenLabs). Until then the UI hides narration.
@router.post("/voice")
def voice(body: VoiceRequest):
    raise HTTPException(503, "Voice narration is not configured yet")
