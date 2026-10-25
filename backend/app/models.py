"""Pydantic schemas: the contract between modules and with the frontend.

Money is always USD (not millions) and durations are months, so the proposal number-check
can match figures exactly against this payload.
"""
from __future__ import annotations

from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    status: str
    db: str
    db_info: dict | None = None
    features: dict[str, bool] = {}  # which optional integrations are configured (gemini, voice)


class City(BaseModel):
    id: int
    name: str
    state: str
    lat: float
    lon: float
    population: int | None = None


# ---------------------------------------------------------------- scoring

class SegmentMiles(BaseModel):
    """Route miles by construction treatment x terrain x density class."""
    treatment: str  # new | upgrade | reactivation
    terrain: str  # flat | rolling | mountainous
    density: str  # rural | suburban | urban
    miles: float


class ScoreBreakdown(BaseModel):
    """Each component is 0-1 relative to the best candidate in the set; weights sum to 1."""
    components: dict[str, float]
    weights: dict[str, float]


class RouteStats(BaseModel):
    length_miles: float
    population_served: int  # residents within buffer_miles of the alignment
    buffer_miles: float
    row_reuse_pct: float  # % of route on existing (active or inactive) rail ROW
    mean_slope_pct: float
    max_slope_pct: float
    env_flag_count: int  # distinct entries into flagged areas
    env_flags: dict[str, int]  # per kind: protected / wetland / floodplain
    river_crossings: int
    river_crossings_new: int  # crossings off existing ROW (new bridges); the rest are rehab
    stations: list[str]
    segments: list[SegmentMiles]
    score: float  # 0-100
    score_breakdown: ScoreBreakdown


# ---------------------------------------------------------------- simulation

class HistogramBin(BaseModel):
    lo: float
    hi: float
    count: int


class Distribution(BaseModel):
    unit: str  # usd | months
    p10: float
    p50: float
    p90: float
    mean: float
    min: float
    max: float
    histogram: list[HistogramBin]


class SimulationSummary(BaseModel):
    runs: int
    source: str  # tiger_cagg | local
    cost: Distribution
    duration: Distribution


# ---------------------------------------------------------------- funding

class CostShare(BaseModel):
    basis_cost_usd: float  # P50 cost
    federal_usd: float
    non_federal_usd: float
    federal_pct: float
    loan_usd: float = 0.0


class FundingMatch(BaseModel):
    program_id: str
    program_name: str
    agency: str
    kind: str  # grant | loan | planning
    eligible: bool
    fit_score: float = Field(ge=0, le=1)
    rationale: str
    cost_share: CostShare


# ---------------------------------------------------------------- plan

class RouteResult(BaseModel):
    id: int | None = None
    rank: int
    key: str
    label: str
    description: str
    geometry: dict  # GeoJSON LineString (lon/lat)
    stats: RouteStats
    simulation: SimulationSummary
    funding: list[FundingMatch]


class PlanResult(BaseModel):
    request_id: int | None = None
    origin: City
    destination: City
    routes: list[RouteResult]
    assumptions: list[str]
    data_sources: dict
    created_at: str
    cached: bool = False
