import type { ReactNode } from "react";
import type { City, PlanResult } from "../api";
import { altStyle, miles } from "../format";
import MapView, { type Basemap, type FitRequest, type Layers } from "./MapView";
import { AltBadge } from "./ui";

interface Props {
  cities: City[];
  plan: PlanResult | null;
  originId: number | null;
  destId: number | null;
  selected: number;
  leader: number | null;
  pickStep: "off" | "origin" | "dest";
  loading: boolean;
  animate: boolean;
  replayKey: number;
  basemap: Basemap;
  layers: Layers;
  fit: FitRequest;
  onCityPick: (id: number) => void;
  onCancelPick: () => void;
  onSelect: (i: number) => void;
  onFit: (kind: FitRequest["kind"]) => void;
  onBasemap: (b: Basemap) => void;
  onLayers: (l: Layers) => void;
  onAnimate: (on: boolean) => void;
  onReplay: () => void;
  /** Content of the semi-transparent overlay on the left of the map. */
  children: ReactNode;
}

const LAYER_LABELS: [keyof Layers, string][] = [
  ["rail", "Existing rail lines (owner on hover)"],
  ["protected", "Protected areas and refuges"],
  ["terrain", "Terrain shading"],
  ["labels", "Place names and boundaries"],
];

// Full-width map hero. The corridor controls and decision summary sit on a gradient overlay at
// the left; the legend and map controls float at the right. On phones the overlays stack below the map.
export default function MapPanel(p: Props) {
  return (
    <section className="hero" aria-label="Corridor map">
      <div className="hero-map">
        <MapView
          cities={p.cities}
          plan={p.plan}
          originId={p.originId}
          destId={p.destId}
          selected={p.selected}
          leader={p.leader}
          pickMode={p.pickStep !== "off"}
          animate={p.animate}
          replayKey={p.replayKey}
          basemap={p.basemap}
          layers={p.layers}
          fit={p.fit}
          onCityPick={p.onCityPick}
          onRouteClick={p.onSelect}
        />
        {p.pickStep !== "off" && (
          <div className="pick-banner" role="status">
            <span>{p.pickStep === "origin" ? "Click the city to start from." : "Now click the destination city."}</span>
            <button onClick={p.onCancelPick}>Cancel</button>
          </div>
        )}
        {p.loading && (
          <div className="map-status" role="status">
            Generating alternatives and running simulations…
          </div>
        )}
      </div>

      <div className="hero-overlay">
        <div className="hero-panel">{p.children}</div>
      </div>

      <aside className="hero-side" aria-label="Legend and map controls">
        {p.plan && (
          <div className="legend">
            <h3>Alternatives</h3>
            <ul className="legend-routes">
              {p.plan.routes.map((r, i) => (
                <li key={r.key}>
                  <button className={i === p.selected ? "on" : ""} aria-pressed={i === p.selected} onClick={() => p.onSelect(i)}>
                    <AltBadge i={i} rank={r.rank} withLine />
                    <span className="lr-name">
                      {r.label}
                      {i === p.leader && <span className="lr-lead"> · leads</span>}
                    </span>
                    <span className="num-cell">{miles(r.stats.length_miles)}</span>
                  </button>
                </li>
              ))}
            </ul>
            <ul className="legend-symbols">
              <li>
                <span className="sym sym-end">A</span> Origin <span className="sym sym-end">B</span> Destination
              </li>
              <li>
                <span className="sym sym-station">1</span> Station on the selected route
              </li>
              {p.layers.rail && (
                <li>
                  <span className="sym-line" /> Existing rail <span className="sym-line dashed" /> inactive
                </li>
              )}
              {p.layers.protected && (
                <li>
                  <span className="sym-area" /> Protected area
                </li>
              )}
            </ul>
            <div className="map-fit">
              <button onClick={() => p.onFit("all")}>Fit all</button>
              <button onClick={() => p.onFit("selected")}>Fit selected</button>
            </div>
          </div>
        )}

        <details className="layer-box">
          <summary>Map layers</summary>
          <div className="seg" role="radiogroup" aria-label="Basemap">
            <button role="radio" aria-checked={p.basemap === "satellite"} className={p.basemap === "satellite" ? "on" : ""} onClick={() => p.onBasemap("satellite")}>
              Satellite
            </button>
            <button role="radio" aria-checked={p.basemap === "light"} className={p.basemap === "light" ? "on" : ""} onClick={() => p.onBasemap("light")}>
              Plain
            </button>
          </div>
          {LAYER_LABELS.map(([k, label]) => (
            <label key={k} className="check">
              <input type="checkbox" checked={p.layers[k]} onChange={(e) => p.onLayers({ ...p.layers, [k]: e.target.checked })} />
              {label}
            </label>
          ))}
          <label className="check">
            <input type="checkbox" checked={p.animate} onChange={(e) => p.onAnimate(e.target.checked)} />
            Animate construction of the selected route
          </label>
          {p.animate && (
            <button className="link" onClick={p.onReplay}>
              Replay
            </button>
          )}
          <p className="fine">Being near an existing rail line does not mean access, spare capacity or permission to operate on it.</p>
        </details>
        <p className="sr-only">
          Route styles: {p.plan?.routes.map((r, i) => `${r.rank} ${r.label}, ${altStyle(i).pattern} line`).join("; ")}
        </p>
      </aside>
    </section>
  );
}

/** Stations of the selected alternative in route order (shown on the Overview tab). */
export function StationsList({ plan, selected }: { plan: PlanResult; selected: number }) {
  const route = plan.routes[selected];
  return (
    <section className="panel stations-list">
      <h3>
        Stations on {route.label} <span className="muted">(in route order)</span>
      </h3>
      <ol>
        {route.stats.station_miles.map((s, k) => (
          <li key={s.name}>
            <span className="seq-n">{k + 1}</span>
            <span className="seq-name">{s.name}</span>
            <span className="num-cell muted">mile {Math.round(s.mile).toLocaleString()}</span>
          </li>
        ))}
      </ol>
      <p className="fine">
        Stations are RailPlanner cities within 5 km of the line. Real station sites and stopping patterns are not designed.
      </p>
    </section>
  );
}
