-- Applied only when the postgis extension is available.

ALTER TABLE routes ADD COLUMN IF NOT EXISTS geom geometry(LineString, 4326);

CREATE INDEX IF NOT EXISTS routes_geom_gix ON routes USING GIST (geom);

ALTER TABLE cities ADD COLUMN IF NOT EXISTS geom geometry(Point, 4326)
    GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(lon, lat), 4326)) STORED;
