import { useState } from "react";
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
}

const LAYER_LABELS: [keyof Layers, string][] = [
  ["rail", "Existing rail lines (owner on hover)"],
  ["protected", "Protected areas and refuges"],
  ["terrain", "Terrain shading"],
  ["labels", "Place names and boundaries"],
];

export default function MapPanel(p: Props) {
  const route = p.plan?.routes[p.selected];
  const [view, setView] = useState<"map" | "list">("map");
  return (
    <section className={`map-panel view-${p.pickStep !== "off" ? "map" : view}`} aria-label="Map of alternatives">
      <div className="seg view-toggle" role="radiogroup" aria-label="Show map or list">
        <button role="radio" aria-checked={view === "map"} className={view === "map" ? "on" : ""} onClick={() => setView("map")}>
          Map
        </button>
        <button role="radio" aria-checked={view === "list"} className={view === "list" ? "on" : ""} onClick={() => setView("list")}>
          List
        </button>
      </div>
      <div className="map-frame">
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
            <span>
              {p.pickStep === "origin" ? "Click the city to start from." : "Now click the destination city."}
            </span>
            <button onClick={p.onCancelPick}>Cancel</button>
          </div>
        )}
        {p.loading && (
          <div className="map-status" role="status">
            Generating alternatives and running simulations…
          </div>
        )}
        {p.plan && (
          <div className="map-fit">
            <button onClick={() => p.onFit("all")}>Fit all routes</button>
            <button onClick={() => p.onFit("selected")}>Fit selected</button>
          </div>
        )}
      </div>

      <div className="map-side">
        {p.plan && (
          <div className="legend">
            <h3>Alternatives</h3>
            <ul className="legend-routes">
              {p.plan.routes.map((r, i) => (
                <li key={r.key}>
                  <button className={i === p.selected ? "on" : ""} aria-pressed={i === p.selected} onClick={() => p.onSelect(i)}>
                    <AltBadge i={i} rank={r.rank} withLine />
                    <span className="lr-name">{r.label}</span>
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
                <span className="sym sym-station">1</span> Station on the selected route, in order
              </li>
              {p.layers.rail && (
                <li>
                  <span className="sym-line" /> Existing rail <span className="sym-line dashed" /> inactive
                </li>
              )}
              {p.layers.protected && (
                <li>
                  <span className="sym-area" /> PAD-US protected area
                </li>
              )}
            </ul>
          </div>
        )}

        {route && (
          <div className="stations-list">
            <h3>
              Stations on {route.label} <span className="muted">(in route order)</span>
            </h3>
            <ol>
              {route.stats.station_miles.map((s) => (
                <li key={s.name}>
                  <span>{s.name}</span>
                  <span className="num-cell muted">mile {Math.round(s.mile)}</span>
                </li>
              ))}
            </ol>
            <p className="fine">
              Stations are RailPlanner cities within 5 km of the line. Real station sites and stopping patterns are
              not designed.
            </p>
          </div>
        )}

        <fieldset className="layer-box">
          <legend>Map</legend>
          <div className="seg" role="radiogroup" aria-label="Basemap">
            <button role="radio" aria-checked={p.basemap === "light"} className={p.basemap === "light" ? "on" : ""} onClick={() => p.onBasemap("light")}>
              Light
            </button>
            <button role="radio" aria-checked={p.basemap === "satellite"} className={p.basemap === "satellite" ? "on" : ""} onClick={() => p.onBasemap("satellite")}>
              Satellite
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
          <p className="fine">
            Being near an existing rail line does not mean access, spare capacity or permission to operate on it.
          </p>
        </fieldset>
        <p className="sr-only">
          Route colors: {p.plan?.routes.map((r, i) => `${r.rank} ${r.label}, ${altStyle(i).pattern} line`).join("; ")}
        </p>
      </div>
    </section>
  );
}
