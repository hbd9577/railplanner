"""Render candidate routes for a city pair over the cost-grid layers, for visual checks.

    python -m scripts.plot_routes Albany Buffalo [--out ../docs/img/routes_albany_buffalo.png]
"""
from __future__ import annotations

import argparse
import time
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
from matplotlib.colors import LightSource  # noqa: E402

from app.routing import generate_candidates, load_cities, load_grid  # noqa: E402

COLORS = ["#2563eb", "#dc2626", "#16a34a"]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("origin")
    ap.add_argument("dest")
    ap.add_argument("--out")
    args = ap.parse_args()

    cities = {c["name"].lower(): c for c in load_cities()}
    o, d = cities[args.origin.lower()], cities[args.dest.lower()]
    t0 = time.perf_counter()
    cands = generate_candidates((o["lon"], o["lat"]), (d["lon"], d["lat"]))
    elapsed = time.perf_counter() - t0

    g = load_grid()
    L = g.layers
    extent = (g.x0, g.x0 + g.shape[1] * g.cell, g.y0 - g.shape[0] * g.cell, g.y0)
    fig, ax = plt.subplots(figsize=(13, 8.5), dpi=110)
    shade = LightSource(azdeg=315, altdeg=45).hillshade(L["elev"], vert_exag=8, dx=g.cell, dy=g.cell)
    ax.imshow(shade, cmap="gray", extent=extent, alpha=0.55, vmin=0, vmax=1)
    overlay = np.zeros((*g.shape, 4))
    overlay[L["env_protected"] > 0] = (0.1, 0.6, 0.2, 0.22)
    overlay[L["env_wetland"] > 0] = (0.0, 0.6, 0.6, 0.45)
    overlay[L["env_floodplain"] > 0] = (0.4, 0.4, 0.9, 0.35)
    overlay[L["row_active"] > 0] = (0.15, 0.15, 0.15, 0.55)
    overlay[L["water"] > 0] = (0.55, 0.75, 0.95, 1.0)
    ax.imshow(overlay, extent=extent)

    for cand, color in zip(cands, COLORS):
        x, y = cand.line.xy
        ax.plot(x, y, color=color, lw=2.6, label=f"{cand.rank}. {cand.label} ({cand.length_miles:.0f} mi)")
    for c in cities.values():
        r, col = g.rc(c["lon"], c["lat"])
        cx, cy = g.xy(np.array([r]), np.array([col]))
        ax.plot(cx, cy, "o", color="black", ms=5)
        ax.annotate(c["name"], (cx[0], cy[0]), xytext=(4, 4), textcoords="offset points", fontsize=9)

    xs = np.concatenate([np.asarray(c.line.xy[0]) for c in cands])
    ys = np.concatenate([np.asarray(c.line.xy[1]) for c in cands])
    pad = 60_000
    ax.set_xlim(xs.min() - pad, xs.max() + pad)
    ax.set_ylim(ys.min() - pad, ys.max() + pad)
    ax.set_xticks([])
    ax.set_yticks([])
    ax.legend(loc="lower right", fontsize=9)
    ax.set_title(f"{o['name']} -> {d['name']}: candidate routes "
                 f"(dark = existing rail, green = protected*, teal = wetland*, purple = floodplain*; *approximate)",
                 fontsize=10)

    out = Path(args.out or f"../docs/img/routes_{o['name'].lower().replace(' ', '_')}_{d['name'].lower().replace(' ', '_')}.png")
    out.parent.mkdir(parents=True, exist_ok=True)
    fig.tight_layout()
    fig.savefig(out)
    print(f"{len(cands)} routes in {elapsed:.2f}s -> {out}")
    for c in cands:
        on_row = float(np.mean(L["row_active"][c.cells[:, 0], c.cells[:, 1]] > 0)) * 100
        print(f"  {c.rank}. {c.label:28s} {c.length_miles:6.1f} mi  on-ROW {on_row:5.1f}%  cost {c.path_cost:8.1f}")


if __name__ == "__main__":
    main()
