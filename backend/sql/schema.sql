-- RailPlanner schema for Tiger Data (Postgres + TimescaleDB).
-- Idempotent: safe to re-run. Statements are split on ';' at end of line by app/db.py
-- and run one at a time (continuous aggregates can't be created inside a transaction).

CREATE TABLE IF NOT EXISTS cities (
    id          SERIAL PRIMARY KEY,
    name        TEXT NOT NULL,
    state       TEXT NOT NULL DEFAULT 'NY',
    lat         DOUBLE PRECISION NOT NULL,
    lon         DOUBLE PRECISION NOT NULL,
    population  INTEGER,
    UNIQUE (name, state)
);

CREATE TABLE IF NOT EXISTS corridor_requests (
    id              SERIAL PRIMARY KEY,
    origin_city_id  INTEGER NOT NULL REFERENCES cities(id),
    dest_city_id    INTEGER NOT NULL REFERENCES cities(id),
    params          JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- geojson is always populated; a PostGIS geom column is added by schema_postgis.sql when available.
CREATE TABLE IF NOT EXISTS routes (
    id                  SERIAL PRIMARY KEY,
    request_id          INTEGER NOT NULL REFERENCES corridor_requests(id) ON DELETE CASCADE,
    rank                SMALLINT NOT NULL,
    label               TEXT,
    strategy            TEXT,
    geojson             JSONB NOT NULL,
    length_miles        DOUBLE PRECISION,
    population_served   BIGINT,
    row_reuse_pct       DOUBLE PRECISION,
    mean_slope          DOUBLE PRECISION,
    max_slope           DOUBLE PRECISION,
    env_flag_count      INTEGER,
    score               DOUBLE PRECISION,
    score_breakdown     JSONB,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS routes_request_idx ON routes (request_id, rank);

-- One row per Monte Carlo draw. Hypertable on time.
CREATE TABLE IF NOT EXISTS simulation_runs (
    time             TIMESTAMPTZ NOT NULL,
    route_id         INTEGER NOT NULL,
    run_id           INTEGER NOT NULL,
    cost_usd         DOUBLE PRECISION NOT NULL,
    duration_months  DOUBLE PRECISION NOT NULL
);

SELECT create_hypertable('simulation_runs', by_range('time', INTERVAL '7 days'), if_not_exists => TRUE);

CREATE INDEX IF NOT EXISTS simulation_runs_route_idx ON simulation_runs (route_id, time DESC);

-- Continuous aggregate serving the dashboard: counts, moments, and fixed-bin histograms.
-- Cost is binned on log10 scale from $10M (7.0) to $1T (12.0) in 1000 bins (~1.2% per bin);
-- duration in 0.5-month bins from 0 to 480 months. histogram() returns nbuckets+2 counts
-- (index 0 = underflow, last = overflow). The API merges buckets across days and derives
-- P10/P50/P90 by interpolating within bins, then re-bins for display.
CREATE MATERIALIZED VIEW IF NOT EXISTS route_sim_stats
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT
    time_bucket(INTERVAL '1 day', time)        AS bucket,
    route_id,
    count(*)                                   AS n,
    min(cost_usd)                              AS cost_min,
    max(cost_usd)                              AS cost_max,
    avg(cost_usd)                              AS cost_mean,
    min(duration_months)                       AS dur_min,
    max(duration_months)                       AS dur_max,
    avg(duration_months)                       AS dur_mean,
    histogram(log(cost_usd), 7.0, 12.0, 1000)  AS cost_hist,
    histogram(duration_months, 0, 480, 960)    AS dur_hist
FROM simulation_runs
GROUP BY bucket, route_id
WITH NO DATA;

SELECT add_continuous_aggregate_policy('route_sim_stats',
    start_offset      => INTERVAL '30 days',
    end_offset        => INTERVAL '1 minute',
    schedule_interval => INTERVAL '5 minutes',
    if_not_exists     => TRUE);

CREATE TABLE IF NOT EXISTS funding_programs (
    id       TEXT PRIMARY KEY,
    name     TEXT NOT NULL,
    agency   TEXT NOT NULL,
    details  JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS route_funding_matches (
    route_id    INTEGER NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
    program_id  TEXT NOT NULL REFERENCES funding_programs(id),
    fit_score   DOUBLE PRECISION NOT NULL,
    rationale   TEXT NOT NULL,
    cost_share  JSONB,
    PRIMARY KEY (route_id, program_id)
);

-- Cached Gemini output per request (proposal markdown, number-check result).
CREATE TABLE IF NOT EXISTS proposals (
    request_id    INTEGER PRIMARY KEY REFERENCES corridor_requests(id) ON DELETE CASCADE,
    markdown      TEXT NOT NULL,
    number_check  JSONB,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Full payloads so a cached plan can be rebuilt exactly (added in Phase 3).
ALTER TABLE routes ADD COLUMN IF NOT EXISTS strategy_description TEXT;

ALTER TABLE routes ADD COLUMN IF NOT EXISTS stats JSONB;

ALTER TABLE route_funding_matches ADD COLUMN IF NOT EXISTS details JSONB;
