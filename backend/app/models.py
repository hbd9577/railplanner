"""Pydantic schemas: the contract between modules and with the frontend.

Phase 1 holds only health; later phases add City, RouteResult, SimulationSummary, FundingMatch, etc.
"""
from pydantic import BaseModel


class HealthResponse(BaseModel):
    status: str
    db: str
    db_info: dict | None = None
