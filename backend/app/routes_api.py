"""HTTP endpoints.

POST /plan resolution order (keeps a working demo path when things fail):
    1. latest stored plan for the pair in Tiger (unless ?fresh=true)
    2. committed JSON demo cache (data/demo_cache/), when USE_DEMO_CACHE is on
    3. compute now: persists to Tiger, or summarizes in-process if the DB is unreachable
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from . import planner
from .config import get_settings
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


@router.get("/plan/{request_id}", response_model=PlanResult)
def get_plan(request_id: int) -> PlanResult:
    try:
        plan = planner.load_plan(request_id)
    except DBUnavailable:
        plan = planner.find_demo_cache_by_request(request_id) if get_settings().use_demo_cache else None
    if plan is None:
        raise HTTPException(404, f"plan {request_id} not found")
    return plan


# Wired up in Phase 6 (Gemini) and Phase 8 (ElevenLabs). Until then the UI hides these features.
@router.post("/proposal/{request_id}")
def create_proposal(request_id: int):
    raise HTTPException(503, "Proposal generation is not configured yet")


@router.post("/ask/{request_id}")
def ask(request_id: int, body: AskRequest):
    raise HTTPException(503, "Q&A is not configured yet")


@router.post("/voice")
def voice(body: VoiceRequest):
    raise HTTPException(503, "Voice narration is not configured yet")
