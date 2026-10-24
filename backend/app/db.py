"""Tiger Data (Postgres + TimescaleDB) connection pool and migration runner.

Usage:
    python -m app.db migrate     # apply sql/schema.sql (+ optional extension files)
    python -m app.db check       # print server/extension info
"""
from __future__ import annotations

import json
import sys
from contextlib import contextmanager
from typing import Iterator

import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from .config import DATA_DIR, SQL_DIR, get_settings

_pool: ConnectionPool | None = None


def get_pool() -> ConnectionPool:
    global _pool
    if _pool is None:
        url = get_settings().database_url
        if not url:
            raise RuntimeError("DATABASE_URL is not set (see .env.example)")
        _pool = ConnectionPool(
            url,
            min_size=1,
            max_size=5,
            kwargs={"row_factory": dict_row, "autocommit": True},
            open=True,
        )
    return _pool


def close_pool() -> None:
    global _pool
    if _pool is not None:
        _pool.close()
        _pool = None


@contextmanager
def connection() -> Iterator[psycopg.Connection]:
    with get_pool().connection() as conn:
        yield conn


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


def migrate() -> dict:
    """Apply schema.sql, then PostGIS add-ons when available, then seed cities."""
    with connection() as conn:
        has_tsdb = _try_extension(conn, "timescaledb")
        if not has_tsdb:
            raise RuntimeError("timescaledb extension is required (Tiger Data services have it)")
        has_postgis = _try_extension(conn, "postgis")

        _apply_file(conn, "schema.sql")
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
