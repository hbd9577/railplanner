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
    stations: list[str]  # ordered along the route, origin first
    station_miles: list[dict] = []  # [{name, mile}] route mile of each station
    pop_near_stations: int = 0  # residents within station_catchment_km of any station (deduplicated)
    station_catchment_km: float = 10
    miles_new: float = 0  # new track off existing rail ROW
    miles_upgrade: float = 0  # on active rail ROW
    miles_reactivation: float = 0  # on inactive/abandoned rail ROW
    miles_new_mountainous: float = 0  # new track in mountainous terrain (mean slope >= 8%)
    env_miles: dict[str, float] = {}  # miles of path inside each flag layer
    env_miles_new: float = 0.0  # miles inside any flag layer, off existing rail corridors (counted once)
    track_profile: list[list] = []  # [start_mile, end_mile, treatment, terrain] runs along the route
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

class ServiceRange(BaseModel):
    p10: float
    p50: float
    p90: float


class ServicePair(BaseModel):
    """One station pair on an alignment: times by mode and modeled annual trips (central case)."""
    a: str
    b: str
    straight_miles: float
    rail_miles: float
    train_min: float
    rail_door_min: float
    car_min: float
    air_min: float | None = None
    trips: float


class ServiceResult(BaseModel):
    """Preliminary service, demand, finance and benefit-cost estimates (app/service.py)."""
    available: bool
    note: str = ""
    round_trips: int = 0
    max_mph_existing: float = 0
    max_mph_new: float = 0
    headway_min: float = 0
    stations: int = 0
    end_to_end_min: float = 0
    avg_speed_mph: float = 0
    end_to_end_car_min: float = 0
    pairs: list[ServicePair] = []
    share_pairs_faster_than_car: float = 0
    riders: ServiceRange | None = None
    passenger_miles: ServiceRange | None = None
    revenue: ServiceRange | None = None
    opex: ServiceRange | None = None
    subsidy: ServiceRange | None = None
    load_factor: float = 0
    capacity_limited_share: float = 0  # share of simulations where demand exceeded the seats offered
    train_miles: float = 0
    trainsets: int = 0
    fleet_cost: ServiceRange | None = None
    bcr: ServiceRange | None = None
    npv: ServiceRange | None = None
    pv_benefits: ServiceRange | None = None
    pv_costs: ServiceRange | None = None
    bcr_alt: ServiceRange | None = None
    npv_alt: ServiceRange | None = None
    user_benefit: ServiceRange | None = None
    safety_benefit: ServiceRange | None = None
    co2_tonnes: ServiceRange | None = None
    fatalities_avoided: ServiceRange | None = None
    car_vmt_avoided: ServiceRange | None = None
    public_share: float = 0
    freight_share: float = 0
    inactive_share: float = 0
    off_rail_share: float = 0
    single_track_share: float | None = None
    track_count_known_share: float = 0
    calibration_error: float = 0


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
    service: ServiceResult | None = None


class PlanResult(BaseModel):
    request_id: int | None = None
    origin: City
    destination: City
    routes: list[RouteResult]
    assumptions: list[str]
    data_sources: dict
    created_at: str
    cached: bool = False
    model_version: str = ""
