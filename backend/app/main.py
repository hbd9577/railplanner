from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import db
from .config import get_settings
from .models import HealthResponse


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    db.close_pool()


settings = get_settings()
app = FastAPI(title="RailPlanner API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    """Liveness plus a DB probe. Stays 200 when the DB is down so the demo cache can still serve."""
    try:
        info = db.db_info()
        return HealthResponse(status="ok", db="ok", db_info=info)
    except Exception as e:  # noqa: BLE001 - surface any connection error as status text
        return HealthResponse(status="degraded", db=f"error: {type(e).__name__}: {e}"[:300])
