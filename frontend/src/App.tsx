import { useEffect, useMemo, useState } from "react";
import { api, type City, type DemoPair, type PlanResult, type RouteResult } from "./api";
import Comparison from "./components/Comparison";
import DistributionChart from "./components/DistributionChart";
import FundingPanel from "./components/FundingPanel";
import MapView from "./components/MapView";
import ProposalPanel from "./components/ProposalPanel";
import RangeCompare from "./components/RangeCompare";
import RouteCards from "./components/RouteCards";
import { ROUTE_COLORS, months, people, usd, years } from "./format";

function Swatch({ i, rank }: { i: number; rank: number }) {
  return (
    <span className="swatch" style={{ background: ROUTE_COLORS[i] }}>
      {rank}
    </span>
  );
}

// "At a glance": which alternative leads on each headline measure.
function Highlights({ routes, onSelect }: { routes: RouteResult[]; onSelect: (i: number) => void }) {
  const leaders: { label: string; pick: (r: RouteResult) => number; best: "max" | "min"; fmt: (v: number) => string }[] = [
    { label: "Highest score", pick: (r) => r.stats.score, best: "max", fmt: (v) => v.toFixed(1) },
    { label: "Lowest cost (P50)", pick: (r) => r.simulation.cost.p50, best: "min", fmt: usd },
    { label: "Fastest to open (P50)", pick: (r) => r.simulation.duration.p50, best: "min", fmt: years },
    { label: "Most people served", pick: (r) => r.stats.population_served, best: "max", fmt: people },
  ];
  return (
    <ul className="highlights">
      {leaders.map((l) => {
        const vals = routes.map(l.pick);
        const v = l.best === "max" ? Math.max(...vals) : Math.min(...vals);
        const i = vals.indexOf(v);
        return (
          <li key={l.label}>
            <button onClick={() => onSelect(i)}>
              <span className="hl-lbl">{l.label}</span>
              <span className="hl-route">
                <Swatch i={i} rank={routes[i].rank} />
                <span className="hl-name">{routes[i].label}</span>
              </span>
              <span className="hl-val">{l.fmt(v)}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export default function App() {
  const [cities, setCities] = useState<City[]>([]);
  const [pairs, setPairs] = useState<DemoPair[]>([]);
  const [originId, setOriginId] = useState<number | null>(null);
  const [destId, setDestId] = useState<number | null>(null);
  const [plan, setPlan] = useState<PlanResult | null>(null);
  const [selected, setSelected] = useState(0);
  const [loading, setLoading] = useState<"boot" | "plan" | null>("boot");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.cities(), api.demoPairs()])
      .then(([cs, ps]) => {
        setCities(cs);
        setPairs(ps);
        if (ps[0]) runPlan(ps[0].origin_id, ps[0].dest_id);
        else setLoading(null);
      })
      .catch((e) => {
        setError(`Could not reach the API (${e.message}).`);
        setLoading(null);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runPlan(o: number, d: number, fresh = false) {
    setOriginId(o);
    setDestId(d);
    setLoading("plan");
    setError(null);
    try {
      const p = await api.plan(o, d, fresh);
      setPlan(p);
      setSelected(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Planning failed");
    } finally {
      setLoading(null);
    }
  }

  function onCityClick(id: number) {
    if (originId == null || destId != null) {
      setOriginId(id);
      setDestId(null);
    } else if (id !== originId) {
      setDestId(id);
    }
  }

  const route = plan?.routes[selected];
  const sorted = useMemo(() => [...cities].sort((a, b) => a.name.localeCompare(b.name)), [cities]);
  const canPlan = originId != null && destId != null && originId !== destId && loading == null;
  const planMatches = plan && plan.origin.id === originId && plan.destination.id === destId;
  const source = route?.simulation.source;

  return (
    <div className="shell">
      <header className="appbar">
        <div className="appbar-inner">
          <div className="brand">
            <span className="logo" aria-hidden>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 17h16M6 21l2-4m10 4-2-4M7 3h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm-2 6h14" />
              </svg>
            </span>
            <div>
              <div className="brand-name">RailPlanner</div>
              <div className="brand-sub">Passenger rail corridor decision support</div>
            </div>
          </div>
          {plan && route && (
            <div className="status">
              <span className="status-item">
                <span className={`dot ${source === "tiger_cagg" ? "live" : "local"}`} />
                {source === "tiger_cagg" ? "Tiger Data" : "Computed locally"}
              </span>
              <span className="status-item">{route.simulation.runs.toLocaleString()} simulations / route</span>
              <span className="status-item">{plan.cached ? "Stored results" : "Computed now"}</span>
            </div>
          )}
        </div>
      </header>

      <div className="disclaimer" role="note">
        <span className="disc-icon" aria-hidden>
          !
        </span>
        <span>
          <strong>Illustrative estimates.</strong> Cost benchmarks are not calibrated. Ranges express modeled
          uncertainty, not a budget or engineering estimate.
        </span>
      </div>

      <main className="app">
        {error && (
          <div className="notice" role="alert">
            {error}
          </div>
        )}

        <section className="layout">
          <aside className="side">
            <div className="card">
              <div className="card-head">
                <h2>Corridor</h2>
              </div>
              <div className="field-lbl">Demo corridors</div>
              <div className="chips">
                {pairs.map((p) => (
                  <button
                    key={p.label}
                    className={`chip ${p.origin_id === originId && p.dest_id === destId ? "on" : ""}`}
                    onClick={() => runPlan(p.origin_id, p.dest_id)}
                    disabled={loading != null}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <div className="selects">
                <label>
                  <span className="field-lbl">From</span>
                  <select value={originId ?? ""} onChange={(e) => setOriginId(Number(e.target.value) || null)}>
                    <option value="">Choose a city</option>
                    {sorted.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}, {c.state}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className="field-lbl">To</span>
                  <select value={destId ?? ""} onChange={(e) => setDestId(Number(e.target.value) || null)}>
                    <option value="">Choose a city</option>
                    {sorted.map((c) => (
                      <option key={c.id} value={c.id} disabled={c.id === originId}>
                        {c.name}, {c.state}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="row">
                <button className="primary grow" disabled={!canPlan} onClick={() => runPlan(originId!, destId!)}>
                  {loading === "plan" ? (
                    <>
                      <span className="spinner" /> Planning…
                    </>
                  ) : (
                    "Plan corridor"
                  )}
                </button>
                {planMatches && (
                  <button
                    disabled={loading != null}
                    onClick={() => runPlan(originId!, destId!, true)}
                    title="Recompute routes and all simulations"
                  >
                    Recompute
                  </button>
                )}
              </div>
              <p className="muted small">Tip: click two cities on the map to choose a corridor.</p>
            </div>

            {plan && (
              <div className="card">
                <div className="card-head">
                  <h2>At a glance</h2>
                  <span className="muted small">
                    {plan.origin.name} → {plan.destination.name}
                  </span>
                </div>
                <Highlights routes={plan.routes} onSelect={setSelected} />
              </div>
            )}
          </aside>

          <div className="map-card">
            <MapView
              cities={cities}
              plan={plan}
              originId={originId}
              destId={destId}
              selected={selected}
              onCityClick={onCityClick}
              onRouteClick={setSelected}
            />
            {loading && (
              <div className="map-loading">
                <span className="spinner dark" />{" "}
                {loading === "boot" ? "Loading…" : "Generating routes and running simulations…"}
              </div>
            )}
            {plan && (
              <div className="legend">
                <div className="legend-title">Candidate alignments</div>
                {plan.routes.map((r, i) => (
                  <button key={r.key} className={i === selected ? "on" : ""} onClick={() => setSelected(i)}>
                    <Swatch i={i} rank={r.rank} />
                    <span>{r.label}</span>
                    <span className="legend-mi">{r.stats.length_miles.toFixed(0)} mi</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>

        {plan && route && (
          <>
            <section>
              <div className="section-title">
                <h2>Alternatives</h2>
                <span className="muted small">Select a card to focus the map and the detail sections below.</span>
              </div>
              <RouteCards routes={plan.routes} selected={selected} onSelect={setSelected} />
            </section>

            <section className="card">
              <div className="card-head">
                <h2>Side-by-side comparison</h2>
                <span className="muted small">Bars scale to the largest value in each row · “Best” marks the leader</span>
              </div>
              <Comparison routes={plan.routes} selected={selected} onSelect={setSelected} />
            </section>

            <section className="card">
              <div className="card-head">
                <h2>Cost &amp; schedule uncertainty</h2>
                <span className="muted small">
                  {route.simulation.runs.toLocaleString()} Monte Carlo runs per alternative
                </span>
              </div>
              <div className="ranges">
                <RangeCompare
                  title="Capital cost"
                  routes={plan.routes}
                  pick={(r) => r.simulation.cost}
                  format={usd}
                  selected={selected}
                  onSelect={setSelected}
                />
                <RangeCompare
                  title="Time to opening"
                  routes={plan.routes}
                  pick={(r) => r.simulation.duration}
                  format={years}
                  selected={selected}
                  onSelect={setSelected}
                />
              </div>
              <div className="subhead">
                <Swatch i={selected} rank={route.rank} />
                <span>
                  Distribution for <strong>{route.label}</strong>
                </span>
              </div>
              <div className="charts">
                <DistributionChart
                  title="Capital cost"
                  dist={route.simulation.cost}
                  color={ROUTE_COLORS[selected]}
                  format={usd}
                  runs={route.simulation.runs}
                />
                <DistributionChart
                  title="Time to opening"
                  dist={route.simulation.duration}
                  color={ROUTE_COLORS[selected]}
                  format={months}
                  runs={route.simulation.runs}
                />
              </div>
              <div className="facts">
                <div>
                  <span className="fact-lbl">Stations</span>
                  <span>{route.stats.stations.join(" · ")}</span>
                </div>
                <div>
                  <span className="fact-lbl">River crossings</span>
                  <span>
                    {route.stats.river_crossings} ({route.stats.river_crossings_new} new)
                  </span>
                </div>
                <div>
                  <span className="fact-lbl">Environmental flags</span>
                  <span>
                    {Object.entries(route.stats.env_flags)
                      .map(([k, v]) => `${v} ${k}`)
                      .join(" · ")}
                  </span>
                </div>
              </div>
            </section>

            <section className="grid2">
              <div className="card">
                <div className="card-head">
                  <h2>Funding programs</h2>
                  <span className="route-tag">
                    <Swatch i={selected} rank={route.rank} /> {route.label}
                  </span>
                </div>
                <FundingPanel matches={route.funding} basis={route.simulation.cost.p50} />
              </div>
              <div className="card">
                <div className="card-head">
                  <h2>Proposal</h2>
                </div>
                <p className="muted small">
                  Drafted by Gemini from the computed results only; it cannot introduce new numbers.
                </p>
                <ProposalPanel requestId={plan.request_id} />
              </div>
            </section>

            <section className="card assumptions">
              <div className="card-head">
                <h2>Assumptions &amp; data sources</h2>
              </div>
              <div className="assume-grid">
                <ul>
                  {plan.assumptions.map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
                <dl className="sources">
                  {Object.entries(plan.data_sources).map(([k, v]) => (
                    <div key={k}>
                      <dt>{k.replace(/_/g, " ")}</dt>
                      <dd>
                        {v.source} <span className={`tag ${v.flag === "real" ? "ok" : ""}`}>{v.flag}</span>
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
              <p className="muted small">Generated {new Date(plan.created_at).toLocaleString()}</p>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
