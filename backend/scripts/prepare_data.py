"""Fetch public data for the New York - Chicago study region and build the 1 km raster stack.

Region: NYC/Philadelphia west to Chicago (NY, NJ, PA, OH, IN, northern IL, southern MI and
slivers of neighboring states). Anything outside US land (Canada, the Great Lakes) is blocked.

Run from backend/:
    python -m scripts.prepare_data            # download (cached in data/raw/) + build
    python -m scripts.prepare_data --force    # re-download everything
    python -m scripts.prepare_data --synthetic-dem

Sources (all public, no keys):
  * Rail lines   BTS NTAD North American Rail Network Lines (ArcGIS FeatureServer), US segments in region
  * Population   Census TIGERweb 2020 tracts in region (POP100 + generalized polygons); also the US land mask
  * Terrain      USGS 3DEP elevation ImageServer, 250 m, aggregated to 1 km slope stats
  * Water        Natural Earth 10m lakes + rivers; DEM <= 0 outside land tracts = ocean
  * Protected    USGS PAD-US 3.0, GAP status 1-2 areas >= 1,000 acres (National Wildlife Refuges -> refuge layer)
  * Floodplain   APPROXIMATE: 1-cell corridor around Natural Earth rivers + hand-digitized NY river
                 outlines from data/env_flags_approx.geojson (flagged in meta)

Outputs (committed, so deploys never need the downloads):
    data/processed/grid.npz        layer arrays, row-major, north-up
    data/processed/grid_meta.json  grid transform/CRS + per-source provenance flags
"""
from __future__ import annotations

import argparse
import io
import json
import sys
import time
import zipfile
from datetime import datetime, timezone
from pathlib import Path

import geopandas as gpd
import numpy as np
import rasterio
import requests
from pyproj import Transformer
from rasterio.features import rasterize
from rasterio.transform import from_origin
from scipy.ndimage import binary_dilation

BACKEND = Path(__file__).resolve().parent.parent
RAW = BACKEND / "data" / "raw"
OUT = BACKEND / "data" / "processed"
ENV_FLAGS = BACKEND / "data" / "env_flags_approx.geojson"

CRS = "EPSG:5070"  # CONUS Albers equal-area, meters
CELL = 1000  # routing grid cell size (m)
FINE = 250  # DEM / population sampling size (m); CELL must be a multiple
REGION_LONLAT_BBOX = (-88.6, 39.3, -71.75, 45.05)
ENVELOPE = {"geometry": ",".join(map(str, REGION_LONLAT_BBOX)), "geometryType": "esriGeometryEnvelope",
            "inSR": 4326, "spatialRel": "esriSpatialRelIntersects"}

NTAD_URL = ("https://services.arcgis.com/xOi1kZaI0eWDREZv/arcgis/rest/services/"
            "NTAD_North_American_Rail_Network_Lines/FeatureServer/0/query")
TRACTS_URL = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Census2020/MapServer/6/query"
DEM_URL = "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage"
NE_LAKES = "https://naciscdn.org/naturalearth/10m/physical/ne_10m_lakes.zip"
NE_LAKES_NA = "https://naciscdn.org/naturalearth/10m/physical/ne_10m_lakes_north_america.zip"
NE_RIVERS = "https://naciscdn.org/naturalearth/10m/physical/ne_10m_rivers_lake_centerlines.zip"
PADUS_URL = ("https://services.arcgis.com/v01gqwM5QqNysAAi/arcgis/rest/services/"
             "Protection_Status_by_GAP_Status_Code/FeatureServer/0/query")

# NTAD NET codes treated as inactive corridors (abandoned / out of service / rail-trail).
INACTIVE_NET = {"A", "X", "T"}

session = requests.Session()
session.headers["User-Agent"] = "RailPlanner-hackathon/0.1 (data prep)"


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


# ---------------------------------------------------------------- grid

def grid_spec() -> tuple[rasterio.Affine, tuple[int, int], tuple[float, float, float, float]]:
    """Snap the region lon/lat bbox (sampled along its edges) to a CELL-aligned Albers grid."""
    t = Transformer.from_crs("EPSG:4326", CRS, always_xy=True)
    w, s, e, n = REGION_LONLAT_BBOX
    lons = np.concatenate([np.linspace(w, e, 50), np.full(50, e), np.linspace(e, w, 50), np.full(50, w)])
    lats = np.concatenate([np.full(50, s), np.linspace(s, n, 50), np.full(50, n), np.linspace(n, s, 50)])
    xs, ys = t.transform(lons, lats)
    xmin = np.floor(min(xs) / CELL) * CELL
    ymin = np.floor(min(ys) / CELL) * CELL
    xmax = np.ceil(max(xs) / CELL) * CELL
    ymax = np.ceil(max(ys) / CELL) * CELL
    shape_ = (int((ymax - ymin) / CELL), int((xmax - xmin) / CELL))
    return from_origin(xmin, ymax, CELL, CELL), shape_, (xmin, ymin, xmax, ymax)


def block_reduce(a: np.ndarray, k: int, fn) -> np.ndarray:
    h, w = a.shape[0] // k, a.shape[1] // k
    return fn(a[: h * k, : w * k].reshape(h, k, w, k), axis=(1, 3))


# ---------------------------------------------------------------- fetchers

def fetch_arcgis_geojson(url: str, where: str, fields: str, cache: Path, force: bool,
                         page: int = 2000, extra: dict | None = None) -> gpd.GeoDataFrame:
    if cache.exists() and not force:
        return gpd.read_file(cache)
    feats, offset = [], 0
    while True:
        params = {"where": where, "outFields": fields, "returnGeometry": "true", "outSR": 4326,
                  "f": "geojson", "resultOffset": offset, "resultRecordCount": page, **(extra or {})}
        r = session.get(url, params=params, timeout=120)
        r.raise_for_status()
        batch = r.json().get("features", [])
        feats += batch
        log(f"  {cache.name}: {len(feats)} features")
        if len(batch) < page:
            break
        offset += page
    cache.write_text(json.dumps({"type": "FeatureCollection", "features": feats}), encoding="utf-8")
    return gpd.read_file(cache)


def fetch_rail(force: bool) -> gpd.GeoDataFrame:
    log("rail lines (NTAD)")
    gdf = fetch_arcgis_geojson(NTAD_URL, "COUNTRY='US'", "FRAARCID,NET,PASSNGR,RROWNER1,TRACKS,STATEAB",
                               RAW / "ntad_rail_region.geojson", force, extra=ENVELOPE)
    return gdf.set_crs(4326, allow_override=True).to_crs(CRS)


def fetch_tracts(force: bool) -> gpd.GeoDataFrame:
    log("census tracts (TIGERweb 2020)")
    gdf = fetch_arcgis_geojson(TRACTS_URL, "1=1", "GEOID,STATE,POP100,AREALAND,AREAWATER",
                               RAW / "tracts_region_2020.geojson", force,
                               extra={"maxAllowableOffset": 0.001, "geometryPrecision": 5, **ENVELOPE})
    gdf = gdf.set_crs(4326, allow_override=True).to_crs(CRS)
    gdf["POP100"] = gdf["POP100"].astype(float)
    gdf["AREALAND"] = gdf["AREALAND"].astype(float)
    return gdf


def fetch_dem(bounds, force: bool) -> tuple[np.ndarray, str]:
    """USGS 3DEP at FINE resolution, fetched in tiles. Returns (dem, source_flag)."""
    cache = RAW / f"dem_region_{FINE}m.npy"
    xmin, ymin, xmax, ymax = bounds
    W, H = int((xmax - xmin) / FINE), int((ymax - ymin) / FINE)
    if cache.exists() and not force:
        return np.load(cache), "usgs_3dep"
    log(f"DEM (USGS 3DEP) {W}x{H} @ {FINE} m")
    tiles_dir = RAW / f"dem_tiles_{FINE}m"
    tiles_dir.mkdir(exist_ok=True)

    def fetch_tile(r0: int, c0: int, h: int, w: int, depth: int = 0) -> np.ndarray:
        """One exportImage request, cached on disk; a tile that keeps failing is split into quarters."""
        tile_cache = tiles_dir / f"{r0}_{c0}_{h}x{w}.npy"
        if tile_cache.exists() and not force:
            return np.load(tile_cache)
        bx0, by1 = xmin + c0 * FINE, ymax - r0 * FINE
        params = {"bbox": f"{bx0},{by1 - h * FINE},{bx0 + w * FINE},{by1}", "bboxSR": 5070, "imageSR": 5070,
                  "size": f"{w},{h}", "format": "tiff", "pixelType": "F32", "noData": -9999,
                  "interpolation": "RSP_BilinearInterpolation", "f": "image"}
        for attempt in range(4):
            try:
                r = session.get(DEM_URL, params=params, timeout=180)
                r.raise_for_status()
                with rasterio.MemoryFile(r.content) as mf, mf.open() as ds:
                    arr = ds.read(1).astype(np.float32)[:h, :w]
                arr[arr <= -9000] = np.nan
                np.save(tile_cache, arr)
                return arr
            except Exception as e:  # noqa: BLE001 - retry any network/decode error
                log(f"  tile {r0},{c0} ({h}x{w}) attempt {attempt + 1} failed: {str(e)[:80]}")
                time.sleep(2 ** attempt)
        if depth >= 2 or min(h, w) < 100:
            raise RuntimeError(f"DEM tile {r0},{c0} failed after retries and splitting")
        h2, w2 = h // 2, w // 2
        out = np.empty((h, w), dtype=np.float32)
        for dr, hh in ((0, h2), (h2, h - h2)):
            for dc, ww in ((0, w2), (w2, w - w2)):
                out[dr:dr + hh, dc:dc + ww] = fetch_tile(r0 + dr, c0 + dc, hh, ww, depth + 1)
        return out

    dem = np.full((H, W), np.nan, dtype=np.float32)
    tile = 1000
    for r0 in range(0, H, tile):
        for c0 in range(0, W, tile):
            h, w = min(tile, H - r0), min(tile, W - c0)
            dem[r0:r0 + h, c0:c0 + w] = fetch_tile(r0, c0, h, w)
            log(f"  tile {r0},{c0} ok")
    np.save(cache, dem)
    return dem, "usgs_3dep"


def synthetic_dem(bounds) -> np.ndarray:
    """Plausible stand-in: low plains + Adirondack/Catskill/Southern Tier highlands + smooth noise."""
    xmin, ymin, xmax, ymax = bounds
    W, H = int((xmax - xmin) / FINE), int((ymax - ymin) / FINE)
    t = Transformer.from_crs(CRS, "EPSG:4326", always_xy=True)
    xs = xmin + (np.arange(W) + 0.5) * FINE
    ys = ymax - (np.arange(H) + 0.5) * FINE
    X, Y = np.meshgrid(xs, ys)
    lon, lat = t.transform(X, Y)
    bump = lambda lo, la, h, r: h * np.exp(-(((lon - lo) / r) ** 2 + ((lat - la) / (r * 0.75)) ** 2))  # noqa: E731
    elev = 120 + 15 * (lat - 41)
    elev += bump(-74.2, 44.1, 900, 0.8) + bump(-74.3, 42.15, 700, 0.35) + bump(-76.5, 42.2, 450, 1.6)
    rng = np.random.default_rng(42)
    noise = rng.normal(size=(H // 8 + 2, W // 8 + 2))
    noise = np.kron(noise, np.ones((8, 8)))[:H, :W]
    from scipy.ndimage import gaussian_filter
    elev += 60 * gaussian_filter(noise, 3)
    return elev.astype(np.float32)


def fetch_ne(url: str, force: bool) -> gpd.GeoDataFrame | None:
    cache = RAW / Path(url).name
    try:
        if not cache.exists() or force:
            log(f"natural earth {cache.name}")
            r = session.get(url, timeout=120)
            r.raise_for_status()
            zipfile.ZipFile(io.BytesIO(r.content))  # validate before caching
            cache.write_bytes(r.content)
        w, s, e, n = REGION_LONLAT_BBOX
        gdf = gpd.read_file(f"zip://{cache.as_posix()}", bbox=(w - 1, s - 1, e + 1, n + 1))
        return gdf.to_crs(CRS)
    except Exception as e:  # noqa: BLE001
        log(f"  ! {cache.name} unavailable ({e}); continuing without it")
        return None


def fetch_padus(force: bool) -> gpd.GeoDataFrame | None:
    log("protected areas (PAD-US GAP 1-2)")
    try:
        gdf = fetch_arcgis_geojson(PADUS_URL, "GAP_Sts IN ('1','2') AND SUM_GIS_Acres >= 1000",
                                   "Unit_Nm,Des_Tp,GAP_Sts,SUM_GIS_Acres", RAW / "padus_gap12_region.geojson",
                                   force, extra={"maxAllowableOffset": 0.002, "geometryPrecision": 5, **ENVELOPE})
        return gdf.set_crs(4326, allow_override=True).to_crs(CRS)
    except Exception as e:  # noqa: BLE001
        log(f"  ! PAD-US unavailable ({e}); falling back to approximate outlines")
        return None


# ---------------------------------------------------------------- build

def burn(geoms, transform, shape_, all_touched=False, values=None, dtype="uint8") -> np.ndarray:
    geoms = [g for g in geoms if g is not None and not g.is_empty]
    if not geoms:
        return np.zeros(shape_, dtype=dtype)
    pairs = zip(geoms, values) if values is not None else ((g, 1) for g in geoms)
    return rasterize(pairs, out_shape=shape_, transform=transform, all_touched=all_touched,
                     fill=0, dtype=dtype)


def build(force: bool, use_synthetic_dem: bool) -> None:
    RAW.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    transform, shape_, bounds = grid_spec()
    k = CELL // FINE
    fine_transform = from_origin(bounds[0], bounds[3], FINE, FINE)
    fine_shape = (shape_[0] * k, shape_[1] * k)
    log(f"grid {shape_[1]}x{shape_[0]} cells @ {CELL} m ({CRS})")
    sources: dict[str, dict] = {}

    # --- population + US land mask
    tracts = fetch_tracts(force)
    land = tracts[tracts["AREALAND"] > 0].copy()
    land["density_km2"] = land["POP100"] / (land["AREALAND"] / 1e6)
    dens_fine = burn(land.geometry, fine_transform, fine_shape, values=land["density_km2"], dtype="float32")
    pop = block_reduce(dens_fine * (FINE / 1000) ** 2, k, np.sum).astype(np.float32)
    pop *= float(tracts["POP100"].sum() / pop.sum())  # undo overlap from simplified tract edges
    in_us = burn(land.geometry, transform, shape_, all_touched=True)
    sources["population"] = {"source": "Census TIGERweb 2020 tracts (POP100)", "flag": "real",
                             "total_rasterized": float(pop.sum()), "total_tracts": float(tracts["POP100"].sum())}
    log(f"  population rasterized {pop.sum():,.0f} vs tracts {tracts['POP100'].sum():,.0f}")

    # --- rail ROW
    rail = fetch_rail(force)
    net = rail["NET"].fillna("").str.upper()
    active = rail[~net.isin(INACTIVE_NET)]
    inactive = rail[net.isin(INACTIVE_NET)]
    passenger = rail[rail["PASSNGR"].fillna("").str.strip() != ""]
    row_active = burn(active.geometry, transform, shape_, all_touched=True)
    row_inactive = burn(inactive.geometry, transform, shape_, all_touched=True) & (1 - row_active)
    row_passenger = burn(passenger.geometry, transform, shape_, all_touched=True)
    sources["rail"] = {"source": "BTS NTAD North American Rail Network Lines", "flag": "real",
                       "segments": int(len(rail)), "active": int(len(active)), "inactive": int(len(inactive))}

    # --- terrain
    dem_flag = "synthetic"
    dem = None
    if not use_synthetic_dem:
        try:
            dem, dem_flag = fetch_dem(bounds, force)
        except Exception as e:  # noqa: BLE001
            log(f"  ! DEM download failed ({e}); using synthetic DEM")
    if dem is None:
        dem = synthetic_dem(bounds)
    dem = dem[: fine_shape[0], : fine_shape[1]]
    missing = np.isnan(dem)
    dem_filled = np.where(missing, 0.0, dem)
    gy, gx = np.gradient(dem_filled, FINE)
    slope_fine = np.hypot(gx, gy) * 100.0  # percent grade
    slope_fine[missing] = 0.0
    slope_mean = block_reduce(slope_fine, k, np.mean).astype(np.float32)
    slope_max = block_reduce(slope_fine, k, np.max).astype(np.float32)
    elev = block_reduce(dem_filled, k, np.mean).astype(np.float32)
    sources["terrain"] = {"source": "USGS 3DEP ImageServer" if dem_flag == "usgs_3dep" else "synthetic DEM",
                          "flag": "real" if dem_flag == "usgs_3dep" else "synthetic",
                          "fine_resolution_m": FINE}

    # --- water
    water = np.zeros(shape_, dtype=np.uint8)
    for url in (NE_LAKES, NE_LAKES_NA):
        g = fetch_ne(url, force)
        if g is not None:
            water |= burn(g.geometry, transform, shape_)
    ocean = (elev <= 0.5) & (in_us == 0)
    water |= ocean.astype(np.uint8)
    rivers = fetch_ne(NE_RIVERS, force)
    river = burn(rivers.geometry, transform, shape_, all_touched=True) if rivers is not None else np.zeros(shape_, np.uint8)
    river &= 1 - water
    sources["water"] = {"source": "Natural Earth 10m lakes/rivers + DEM ocean mask", "flag": "real (coarse)"}

    # --- environmental flags
    env = gpd.read_file(ENV_FLAGS).set_crs(4326, allow_override=True).to_crs(CRS)
    env["geometry"] = [g.buffer(b * 1000) if b else g for g, b in zip(env.geometry, env["buffer_km"].fillna(0))]
    approx = {kind: burn(env[env["kind"] == kind].geometry, transform, shape_, all_touched=True)
              for kind in ("protected", "wetland", "floodplain")}
    padus = fetch_padus(force)
    if padus is not None:
        refuge = padus["Des_Tp"].fillna("") == "NWR"
        layers_env = {"protected": burn(padus[~refuge].geometry, transform, shape_),
                      "wetland": burn(padus[refuge].geometry, transform, shape_, all_touched=True)}
        sources["protected_areas"] = {"source": "USGS PAD-US 3.0 (GAP 1-2, >= 1,000 acres)", "flag": "real",
                                      "features": int(len(padus)), "wildlife_refuges": int(refuge.sum())}
    else:
        layers_env = {"protected": approx["protected"], "wetland": approx["wetland"]}
        sources["protected_areas"] = {"source": str(ENV_FLAGS.name), "flag": "approximate (hand-digitized, NY only)"}
    river_corridor = binary_dilation(river > 0, iterations=1) & (water == 0)
    layers_env["floodplain"] = (approx["floodplain"] | river_corridor).astype(np.uint8)
    sources["floodplain"] = {"source": f"Natural Earth river corridors + {ENV_FLAGS.name} (NY rivers)",
                             "flag": "approximate (proxy, demo only)"}

    arrays = {
        "in_us": in_us, "pop": pop, "elev": elev.astype(np.float16),
        "slope_mean": slope_mean.astype(np.float16), "slope_max": slope_max.astype(np.float16),
        "row_active": row_active, "row_inactive": row_inactive, "row_passenger": row_passenger,
        "water": water, "river": river,
        "env_protected": layers_env["protected"], "env_wetland": layers_env["wetland"],
        "env_floodplain": layers_env["floodplain"],
    }
    for name, a in arrays.items():
        assert a.shape == shape_, (name, a.shape, shape_)
    np.savez_compressed(OUT / "grid.npz", **arrays)
    meta = {
        "region": "New York - Chicago", "lonlat_bbox": list(REGION_LONLAT_BBOX), "crs": CRS, "cell_m": CELL, "shape": list(shape_), "transform": list(transform)[:6],
        "bounds": list(bounds), "built_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "layers": list(arrays), "sources": sources,
    }
    (OUT / "grid_meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    size_mb = (OUT / "grid.npz").stat().st_size / 1e6
    log(f"wrote grid.npz ({size_mb:.1f} MB) with {len(arrays)} layers")
    for name, a in arrays.items():
        log(f"  {name:15s} nonzero={int(np.count_nonzero(a)):8d}  max={float(a.max()):.1f}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--synthetic-dem", action="store_true")
    args = ap.parse_args()
    try:
        build(args.force, args.synthetic_dem)
    except requests.HTTPError as e:
        sys.exit(f"download failed: {e}")
