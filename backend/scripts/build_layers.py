"""Build small, simplified GeoJSON map layers from the cached raw downloads (run prepare_data first).

    python -m scripts.build_layers

Outputs (committed, served by GET /layers/{name}):
    data/processed/layers/rail.geojson       existing rail lines: owner, status, passenger service, tracks
    data/processed/layers/protected.geojson  PAD-US GAP 1-2 areas >= 1,000 acres: name, designation, refuge flag
"""
from __future__ import annotations

import json
from pathlib import Path

import geopandas as gpd

BACKEND = Path(__file__).resolve().parent.parent
RAW = BACKEND / "data" / "raw"
OUT = BACKEND / "data" / "processed" / "layers"
INACTIVE_NET = {"A", "X", "T"}


def _round(coords, nd=4):
    if isinstance(coords[0], (int, float)):
        return [round(coords[0], nd), round(coords[1], nd)]
    return [_round(c, nd) for c in coords]


def _write(gdf: gpd.GeoDataFrame, props: list[str], path: Path, tolerance: float) -> None:
    feats = []
    for _, row in gdf.iterrows():
        if row.geometry is None:
            continue
        geom = row.geometry.simplify(tolerance, preserve_topology=False)
        if geom.is_empty:
            continue
        g = geom.__geo_interface__
        feats.append({"type": "Feature", "properties": {k: row[k] for k in props},
                      "geometry": {"type": g["type"], "coordinates": _round(g["coordinates"])}})
    path.write_text(json.dumps({"type": "FeatureCollection", "features": feats}, separators=(",", ":")),
                    encoding="utf-8")
    print(f"{path.name}: {len(feats)} features, {path.stat().st_size / 1e6:.1f} MB")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)

    rail = gpd.read_file(RAW / "ntad_rail_region.geojson")
    net = rail["NET"].fillna("").str.upper()
    rail["status"] = ["inactive" if n in INACTIVE_NET else "active" for n in net]
    rail["owner"] = rail["RROWNER1"].fillna("unknown")
    rail["passenger"] = rail["PASSNGR"].fillna("").str.strip()
    rail["tracks"] = rail["TRACKS"].fillna(0).astype(int)
    # merge segments with identical attributes so the file stays small
    merged = rail.dissolve(by=["owner", "status", "passenger", "tracks"], as_index=False)
    _write(merged, ["owner", "status", "passenger", "tracks"], OUT / "rail.geojson", tolerance=0.002)

    pad = gpd.read_file(RAW / "padus_gap12_region.geojson")
    pad["name"] = pad["Unit_Nm"].fillna("Protected area")
    pad["designation"] = pad["Des_Tp"].fillna("")
    pad["refuge"] = pad["designation"] == "NWR"
    _write(pad, ["name", "designation", "refuge"], OUT / "protected.geojson", tolerance=0.003)


if __name__ == "__main__":
    main()
