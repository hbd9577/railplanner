"""Tiger Data (Postgres + TimescaleDB) connection pool and migration runner.

Usage:
    python -m app.db migrate     # apply sql/schema.sql (+ optional extension files)
    python -m app.db check       # print server/extension info
"""
from __future__ import annotations

import json
import sys
import time
from contextlib import contextmanager
from typing import Iterator

import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool, PoolTimeout

from .config import DATA_DIR, SQL_DIR, get_settings

_pool: ConnectionPool | None = None
_down_until = 0.0
COOLDOWN_S = 30.0  # after a connection failure, fail fast for this long so fallbacks stay snappy
CONNECT_TIMEOUT_S = 5


class DBUnavailable(RuntimeError):
    """The database could not be reached (or is in its failure cool-down)."""


def get_pool() -> ConnectionPool:
    global _pool
    if _pool is None:
        url = get_settings().database_url
        if not url:
            raise DBUnavailable("DATABASE_URL is not set (see .env.example)")
        _pool = ConnectionPool(
            url,
            min_size=1,
            max_size=5,
            timeout=CONNECT_TIMEOUT_S,
            kwargs={"row_factory": dict_row, "autocommit": True, "connect_timeout": CONNECT_TIMEOUT_S},
            open=True,
        )
    return _pool


def close_pool() -> None:
    global _pool
    if _pool is not None:
        _pool.close()
        _pool = None


def _mark_down() -> None:
    global _down_until
    _down_until = time.monotonic() + COOLDOWN_S


def available() -> bool:
    return time.monotonic() >= _down_until


@contextmanager
def connection() -> Iterator[psycopg.Connection]:
    """Pooled connection. Connection-level failures raise DBUnavailable and start a cool-down."""
    if not available():
        raise DBUnavailable("database unavailable (cool-down after a recent failure)")
    try:
        pool_cm = get_pool().connection()
        conn = pool_cm.__enter__()
    except (psycopg.OperationalError, PoolTimeout) as e:
        _mark_down()
        raise DBUnavailable(str(e)) from e
    try:
        yield conn
    except BaseException as e:
        if isinstance(e, psycopg.OperationalError):
            _mark_down()
        if not pool_cm.__exit__(*sys.exc_info()):
            raise
    else:
        pool_cm.__exit__(None, None, None)


def db_info() -> dict:
    """Server version and which extensions we care about are installed."""
    with connection() as conn:
        version = conn.execute("SHOW server_version").fetchone()["server_version"]
        rows = conn.execute(
            "SELECT extname, extversion FROM pg_extension "
            "WHERE extname IN ('timescaledb', 'postgis', 'timescaledb_toolkit')"
        ).fetchall()
    exts = {r["extname"]: r["extversion"] for r in rows}
    return {"server_version": version, "extensions": exts}


def _try_extension(conn: psycopg.Connection, name: str) -> bool:
    try:
        conn.execute(f"CREATE EXTENSION IF NOT EXISTS {name}")
        return True
    except psycopg.Error as e:
        print(f"  ! extension {name} unavailable: {e.diag.message_primary or e}")
        return False


def split_sql(text: str) -> list[str]:
    """Split a script into statements on ';' at end of line, dropping comment-only chunks."""
    stmts, buf = [], []
    for line in text.splitlines():
        if line.strip().startswith("--"):
            continue
        buf.append(line)
        if line.rstrip().endswith(";"):
            stmt = "\n".join(buf).strip()
            if stmt:
                stmts.append(stmt)
            buf = []
    tail = "\n".join(buf).strip()
    if tail:
        stmts.append(tail)
    return stmts


def _apply_file(conn: psycopg.Connection, name: str) -> None:
    print(f"  applying {name}")
    for stmt in split_sql((SQL_DIR / name).read_text(encoding="utf-8")):
        conn.execute(stmt)


def seed_cities(conn: psycopg.Connection) -> int:
    cities = json.loads((DATA_DIR / "cities.json").read_text(encoding="utf-8"))
    for c in cities:
        conn.execute(
            "INSERT INTO cities (name, state, lat, lon, population) "
            "VALUES (%(name)s, %(state)s, %(lat)s, %(lon)s, %(population)s) "
            "ON CONFLICT (name, state) DO UPDATE SET lat = EXCLUDED.lat, lon = EXCLUDED.lon, "
            "population = EXCLUDED.population",
            c,
        )
    return len(cities)


# Bump when the route_sim_stats definition changes; migrate() drops and recreates an older view.
# Raw runs live in the simulation_runs hypertable, so recreating the aggregate loses nothing.
CAGG_VERSION = "cost_log10_7_12_v2"


def _reset_stale_cagg(conn: psycopg.Connection) -> None:
    row = conn.execute(
        "SELECT obj_description('route_sim_stats'::regclass, 'pg_class') AS v "
        "WHERE to_regclass('route_sim_stats') IS NOT NULL").fetchone()
    if row is not None and row["v"] != CAGG_VERSION:
        print(f"  dropping route_sim_stats (version {row['v']!r} != {CAGG_VERSION!r})")
        conn.execute("DROP MATERIALIZED VIEW route_sim_stats")


def migrate() -> dict:
    """Apply schema.sql, then PostGIS add-ons when available, then seed cities."""
    with connection() as conn:
        has_tsdb = _try_extension(conn, "timescaledb")
        if not has_tsdb:
            raise RuntimeError("timescaledb extension is required (Tiger Data services have it)")
        has_postgis = _try_extension(conn, "postgis")

        _reset_stale_cagg(conn)
        _apply_file(conn, "schema.sql")
        conn.execute(f"COMMENT ON VIEW route_sim_stats IS '{CAGG_VERSION}'")
        if has_postgis:
            _apply_file(conn, "schema_postgis.sql")
        else:
            print("  ! PostGIS missing: geometry stored as GeoJSON in routes.geojson only")
        n = seed_cities(conn)
        print(f"  seeded {n} cities")
    return {"timescaledb": has_tsdb, "postgis": has_postgis}


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "check"
    if cmd == "migrate":
        print(migrate())
        print(db_info())
    elif cmd == "check":
        print(db_info())
    else:
        sys.exit(f"unknown command: {cmd}")
    close_pool()
