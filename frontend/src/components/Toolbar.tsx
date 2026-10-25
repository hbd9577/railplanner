import { useEffect, useId, useState } from "react";
import type { City } from "../api";
import type { Scenario } from "../scenario";

const cityLabel = (c: City) => `${c.name}, ${c.state}`;

function CityField({ label, cities, value, exclude, onChange }: {
  label: string;
  cities: City[];
  value: number | null;
  exclude: number | null;
  onChange: (id: number | null) => void;
}) {
  const listId = useId();
  const current = cities.find((c) => c.id === value);
  const [text, setText] = useState(current ? cityLabel(current) : "");
  useEffect(() => setText(current ? cityLabel(current) : ""), [current]);
  const options = cities.filter((c) => c.id !== exclude);
  return (
    <label className="city-field">
      <span>{label}</span>
      <input
        list={listId}
        value={text}
        placeholder="Type a city"
        autoComplete="off"
        onChange={(e) => {
          setText(e.target.value);
          const t = e.target.value.trim().toLowerCase();
          const hit = options.find((c) => cityLabel(c).toLowerCase() === t || c.name.toLowerCase() === t);
          onChange(hit ? hit.id : null);
        }}
        onBlur={() => current && setText(cityLabel(current))}
      />
      <datalist id={listId}>
        {options.map((c) => (
          <option key={c.id} value={cityLabel(c)} />
        ))}
      </datalist>
    </label>
  );
}

interface Props {
  cities: City[];
  originId: number | null;
  destId: number | null;
  onOrigin: (id: number | null) => void;
  onDest: (id: number | null) => void;
  onSwap: () => void;
  onCompare: () => void;
  canCompare: boolean;
  loading: boolean;
  upToDate: boolean;
  picking: boolean;
  onPick: () => void;
  hasPlan: boolean;
  prioritiesOpen: boolean;
  customWeights: boolean;
  onPriorities: () => void;
  onRerun: () => void;
  onSave: () => void;
  onShare: () => void;
  onExport: () => void;
  saved: Scenario[];
  onLoad: (s: Scenario) => void;
  onDelete: (s: Scenario) => void;
  message: string | null;
}

export default function Toolbar(p: Props) {
  const [menu, setMenu] = useState<"none" | "assumptions" | "saved">("none");
  const toggle = (m: typeof menu) => setMenu((x) => (x === m ? "none" : m));
  return (
    <div className="toolbar" role="toolbar" aria-label="Scenario">
      <div className="tb-brand">
        <span className="wordmark">RailPlanner</span>
        <span className="tb-tag">Corridor screening</span>
      </div>

      <div className="tb-corridor">
        <CityField label="From" cities={p.cities} value={p.originId} exclude={p.destId} onChange={p.onOrigin} />
        <button className="icon-btn" onClick={p.onSwap} aria-label="Swap origin and destination" title="Swap">
          ⇄
        </button>
        <CityField label="To" cities={p.cities} value={p.destId} exclude={p.originId} onChange={p.onDest} />
        <button className="primary" onClick={p.onCompare} disabled={!p.canCompare || p.loading}>
          {p.loading ? "Comparing…" : p.upToDate ? "Routes compared" : "Compare routes"}
        </button>
        <button className={`ghost${p.picking ? " on" : ""}`} onClick={p.onPick} aria-pressed={p.picking}>
          Pick on map
        </button>
      </div>

      <div className="tb-actions">
        {p.hasPlan && (
          <button className={p.prioritiesOpen ? "on" : ""} aria-expanded={p.prioritiesOpen} onClick={p.onPriorities}>
            Priorities{p.customWeights ? " (custom)" : ""}
          </button>
        )}
        {p.hasPlan && (
          <div className="menu-wrap">
            <button aria-expanded={menu === "assumptions"} onClick={() => toggle("assumptions")}>
              Assumptions
            </button>
            {menu === "assumptions" && (
              <div className="menu" role="dialog" aria-label="Model assumptions">
                <p>
                  Results come from stored runs of the current model version when available, so the same corridor
                  always shows the same numbers.
                </p>
                <p className="fine">
                  Cost benchmarks, schedule durations and funding rules are fixed, illustrative inputs; they are listed
                  on the Methodology tab. Editing them is not supported yet.
                </p>
                <button
                  onClick={() => {
                    setMenu("none");
                    p.onRerun();
                  }}
                  disabled={p.loading}
                >
                  Rerun routing and simulations
                </button>
                <p className="fine">
                  Ignores stored results and recomputes from scratch. Simulations are seeded from each route, so the
                  figures only change if the model or its data changed.
                </p>
              </div>
            )}
          </div>
        )}
        <span className="tb-sep" aria-hidden="true" />
        <button onClick={p.onSave} disabled={!p.hasPlan}>
          Save
        </button>
        <div className="menu-wrap">
          <button aria-expanded={menu === "saved"} onClick={() => toggle("saved")} disabled={!p.saved.length}>
            Saved ({p.saved.length})
          </button>
          {menu === "saved" && (
            <div className="menu" role="dialog" aria-label="Saved scenarios">
              <ul className="saved-list">
                {p.saved.map((s) => (
                  <li key={s.savedAt}>
                    <button
                      className="link"
                      onClick={() => {
                        setMenu("none");
                        p.onLoad(s);
                      }}
                    >
                      {s.name}
                    </button>
                    <span className="muted">{new Date(s.savedAt).toLocaleDateString()}</span>
                    <button className="link danger" onClick={() => p.onDelete(s)} aria-label={`Remove ${s.name}`}>
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
              <p className="fine">Saved in this browser only.</p>
            </div>
          )}
        </div>
        <button onClick={p.onShare} disabled={!p.hasPlan}>
          Share
        </button>
        <button onClick={p.onExport} disabled={!p.hasPlan}>
          Export report
        </button>
      </div>
      {p.message && (
        <div className="tb-message" role="status">
          {p.message}
        </div>
      )}
    </div>
  );
}
