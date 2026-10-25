import { useEffect, useId, useRef, useState } from "react";
import type { City } from "../api";
import type { Scenario } from "../scenario";

const STATE_REGION: Record<string, string> = { NY: "New York", PA: "Pennsylvania", OH: "Ohio", IN: "Indiana", IL: "Illinois" };
const cityLabel = (c: City) => `${c.name}, ${c.state}`;

function CityField({ label, cities, value, exclude, onChange }: {
  label: string;
  cities: City[];
  value: number | null;
  exclude: number | null;
  onChange: (id: number | null) => void;
}) {
  const listId = useId();
  const hintId = useId();
  const current = cities.find((c) => c.id === value);
  const [text, setText] = useState(current ? cityLabel(current) : "");
  // Re-sync only when the value changes from outside this field (swap, map pick, start over),
  // so a partly typed name is never wiped while the user is typing.
  const emitted = useRef<number | null | undefined>(undefined);
  useEffect(() => {
    if (value !== emitted.current) setText(current ? cityLabel(current) : "");
    emitted.current = value;
  }, [value, current]);
  const options = cities.filter((c) => c.id !== exclude);
  const [focused, setFocused] = useState(false);
  const invalid = !focused && text.trim() !== "" && !current; // judged after the user leaves the field
  return (
    <label className="city-field">
      <span>{label}</span>
      <input
        list={listId}
        value={text}
        placeholder="Type a city"
        autoComplete="off"
        aria-invalid={invalid}
        aria-describedby={invalid ? hintId : undefined}
        onChange={(e) => {
          setText(e.target.value);
          const t = e.target.value.trim().toLowerCase();
          const hit = options.find((c) => cityLabel(c).toLowerCase() === t || c.name.toLowerCase() === t);
          emitted.current = hit ? hit.id : null;
          onChange(hit ? hit.id : null);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          if (current) setText(cityLabel(current));
        }}
      />
      <datalist id={listId}>
        {options.map((c) => (
          <option key={c.id} value={cityLabel(c)}>
            {STATE_REGION[c.state] ?? c.state}
          </option>
        ))}
      </datalist>
      {invalid && (
        <span className="field-hint" id={hintId}>
          Choose one of the {cities.length} supported cities from the list.
        </span>
      )}
    </label>
  );
}

/** Small disclosure menu that closes on Escape or an outside click. */
function Menu({ label, disabled, children }: { label: string; disabled?: boolean; children: (close: () => void) => React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  return (
    <div className="menu-wrap" ref={ref}>
      <button aria-expanded={open} aria-haspopup="true" onClick={() => setOpen((o) => !o)} disabled={disabled}>
        {label} <span aria-hidden="true">▾</span>
      </button>
      {open && <div className="menu">{children(() => setOpen(false))}</div>}
    </div>
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
  unsaved: boolean;
  onShare: () => void;
  onExport: (kind: "html" | "pdf" | "csv") => void;
  onStartOver: () => void;
  saved: Scenario[];
  onLoad: (s: Scenario) => void;
  onCompareWith: (s: Scenario) => void;
  onDelete: (s: Scenario) => void;
}

export default function Toolbar(p: Props) {
  const sameCity = p.originId != null && p.originId === p.destId;
  // On phones the corridor fields fold into a one-line summary once results match them.
  const [editing, setEditing] = useState(false);
  const folded = p.hasPlan && p.upToDate && !editing && !p.picking;
  const name = (id: number | null) => p.cities.find((c) => c.id === id)?.name ?? "";
  useEffect(() => {
    if (p.loading) setEditing(false);
  }, [p.loading]);
  return (
    <div className="toolbar" role="region" aria-label="Scenario controls">
      <div className="tb-brand">
        <span className="wordmark">RailPlanner</span>
        <span className="tb-tag">Corridor screening</span>
      </div>

      {folded && (
        <div className="tb-folded">
          <span>
            {name(p.originId)} → {name(p.destId)}
          </span>
          <button onClick={() => setEditing(true)}>Change corridor</button>
        </div>
      )}
      <div className={`tb-corridor${folded ? " folded" : ""}`}>
        <CityField label="From" cities={p.cities} value={p.originId} exclude={p.destId} onChange={p.onOrigin} />
        <button className="icon-btn" onClick={p.onSwap} aria-label="Swap origin and destination" title="Swap origin and destination">
          <span aria-hidden="true">⇄</span>
        </button>
        <CityField label="To" cities={p.cities} value={p.destId} exclude={p.originId} onChange={p.onDest} />
        <button className="primary" onClick={p.onCompare} disabled={!p.canCompare || p.loading}>
          {p.loading ? "Comparing…" : p.upToDate ? "Routes compared" : "Compare routes"}
        </button>
        <button className={`ghost${p.picking ? " on" : ""}`} onClick={p.onPick} aria-pressed={p.picking}>
          {p.picking ? "Cancel picking" : "Pick on map"}
        </button>
        {sameCity && <span className="field-hint">Origin and destination must be different cities.</span>}
      </div>

      <div className="tb-actions">
        {p.hasPlan && (
          <button className={p.prioritiesOpen ? "on" : ""} aria-expanded={p.prioritiesOpen} onClick={p.onPriorities}>
            Priorities{p.customWeights ? " (custom)" : ""}
          </button>
        )}
        {p.hasPlan && (
          <Menu label="Assumptions">
            {(close) => (
              <div role="group" aria-label="Model assumptions">
                <p>
                  Results come from stored runs of the current model version when available, so the same corridor
                  always shows the same numbers.
                </p>
                <p className="fine">
                  Cost benchmarks, schedule durations and funding rules are fixed, illustrative inputs listed on the
                  Methodology tab. Editing them needs a backend change and is not available yet.
                </p>
                <button
                  onClick={() => {
                    close();
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
          </Menu>
        )}
        <span className="tb-sep" aria-hidden="true" />
        <button onClick={p.onSave} disabled={!p.hasPlan}>
          Save{p.unsaved && <span className="unsaved"> • unsaved changes</span>}
        </button>
        <Menu label={`Saved (${p.saved.length})`}>
          {(close) =>
            p.saved.length === 0 ? (
              <p className="fine">
                No saved scenarios yet. Compare routes, then Save to keep the corridor, selected alternative and
                priorities in this browser.
              </p>
            ) : (
              <>
                <ul className="saved-list">
                  {p.saved.map((s) => (
                    <li key={s.savedAt}>
                      <span className="saved-name">
                        {s.name}
                        <span className="muted block">{new Date(s.savedAt).toLocaleString()}</span>
                      </span>
                      <span className="saved-actions">
                        <button
                          className="link"
                          onClick={() => {
                            close();
                            p.onLoad(s);
                          }}
                        >
                          Open
                        </button>
                        <button
                          className="link"
                          disabled={!p.hasPlan}
                          onClick={() => {
                            close();
                            p.onCompareWith(s);
                          }}
                        >
                          Compare
                        </button>
                        <button className="link danger" onClick={() => p.onDelete(s)} aria-label={`Remove ${s.name}`}>
                          Remove
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="fine">Saved in this browser only; not shared across devices.</p>
              </>
            )
          }
        </Menu>
        <button onClick={p.onShare} disabled={!p.hasPlan}>
          Share
        </button>
        <Menu label="Export" disabled={!p.hasPlan}>
          {(close) => (
            <ul className="menu-list">
              {([
                ["pdf", "Report as PDF", "Opens the print dialog; choose Save as PDF."],
                ["html", "Report as HTML", "A self-contained page you can email or archive."],
                ["csv", "Results as CSV", "Every measure, range, station and priority, with status labels."],
              ] as const).map(([k, title, help]) => (
                <li key={k}>
                  <button
                    className="menu-item"
                    onClick={() => {
                      close();
                      p.onExport(k);
                    }}
                  >
                    <span>{title}</span>
                    <span className="fine">{help}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Menu>
        <button className="ghost" onClick={p.onStartOver}>
          Start over
        </button>
      </div>
    </div>
  );
}
