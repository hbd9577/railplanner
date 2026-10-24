from fastapi.testclient import TestClient

from app.config import SQL_DIR
from app.db import split_sql
from app.main import app


def test_health_responds():
    with TestClient(app) as client:  # context manager runs lifespan, which closes the DB pool
        r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] in {"ok", "degraded"}


def test_schema_splits_into_statements():
    stmts = split_sql((SQL_DIR / "schema.sql").read_text(encoding="utf-8"))
    assert any("create_hypertable" in s for s in stmts)
    cagg = [s for s in stmts if "timescaledb.continuous" in s]
    assert len(cagg) == 1 and cagg[0].rstrip().endswith("WITH NO DATA;")
    assert all(s.rstrip().endswith(";") for s in stmts)
