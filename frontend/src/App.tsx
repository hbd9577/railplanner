import { useEffect, useMemo, useState } from "react";
import { api, type City, type PlanResult } from "./api";
import Comparison from "./components/Comparison";
import DistributionChart from "./components/DistributionChart";
import FundingPanel from "./components/FundingPanel";
import MapView from "./components/MapView";
import ProposalPanel from "./components/ProposalPanel";
import RangeCompare from "./components/RangeCompare";
import RouteCards from "./components/RouteCards";
import Summary from "./components/Summary";
import { PALETTE, badgeStyle, months, usd, years } from "./format";

function Num({ i, rank, selected }: { i: number; rank: number; selected: number }) {
  return (
    <span className="num" style={badgeStyle(i, selected)}>
      {rank}
    </span>
  );
}

export default function App() {
  const [cities, setCities] = useState<City[]>([]);
  const [originId, setOriginId] = useState<number | null>(null);
  const [destId, setDestId] = useState<number | null>(null);
  const [plan, setPlan] = useState<PlanResult | null>(null);
  const [selected, setSelected] = useState(0);
  const [loading, setLoading] = useState<"plan" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [animate, setAnimate] = useState(true);
  const [replayKey, setReplayKey] = useState(0);

  useEffect(() => {
    api
      .cities()
      .then((cs) => {
        setCities(cs);
        // A shared link (?from=ID&to=ID) reopens that corridor's results; otherwise start empty.
        const q = new URLSearchParams(window.location.search);
        const o = Number(q.get("from"));
        const d = Number(q.get("to"));
        if (o !== d && cs.some((c) => c.id === o) && cs.some((c) => c.id === d)) runPlan(o, d);
      })
      .catch((e) => setError(`Could not reach the API (${e.message}).`));
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
      window.history.replaceState(null, "", `?from=${o}&to=${d}`);
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

  return (
    <div className="page">
      <header className="masthead">
        <div className="masthead-inner">
          <div>
            <div className="wordmark">RailPlanner</div>
            <div className="dek">Corridor alternatives, cost and schedule ranges, and federal funding fit</div>
          </div>
          {plan && route && (
            <div className="provenance">
              {route.simulation.source === "tiger_cagg" ? "Results from Tiger Data" : "Results computed locally"}
              {" · "}
              {route.simulation.runs.toLocaleString()} simulations per alternative
              {" · "}
              {plan.cached ? "stored run" : "new run"}
            </div>
          )}
        </div>
      </header>

      {/* Full-width map hero; controls float over its left edge on a semi-transparent gradient. */}
      <section className="hero" aria-label="Corridor map">
        <div className="hero-map">
          <MapView
            cities={cities}
            plan={plan}
            originId={originId}
            destId={destId}
            selected={selected}
            animate={animate}
            replayKey={replayKey}
            onCityClick={onCityClick}
            onRouteClick={setSelected}
          />
          {loading && <div className="map-loading">Generating routes and running simulations…</div>}
        </div>

        <div className="hero-overlay">
          <div className="hero-panel">
            <div className="ov-block">
              <h2>Corridor</h2>
              <p className="ov-note">Choose an origin and a destination, or pick two cities on the map.</p>
              <div className="selects">
                <label>
                  From
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
                  To
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
                <button className="primary" disabled={!canPlan} onClick={() => runPlan(originId!, destId!)}>
                  {loading === "plan" ? "Planning…" : "Plan corridor"}
                </button>
                {planMatches && (
                  <button
                    className="ghost"
                    disabled={loading != null}
                    onClick={() => runPlan(originId!, destId!, true)}
                    title="Recompute routes and all simulations"
                  >
                    Recompute
                  </button>
                )}
              </div>
              {error && (
                <div className="notice" role="alert">
                  {error}
                </div>
              )}
            </div>

            {plan && (
              <div className="ov-block">
                <h2>Routes</h2>
                <div className="ov-routes">
                  {plan.routes.map((r, i) => (
                    <button key={r.key} className={i === selected ? "on" : ""} onClick={() => setSelected(i)}>
                      <span className="num" style={badgeStyle(i, selected)}>
                        {r.rank}
                      </span>
                      <span>{r.label}</span>
                      <span className="mi">{r.stats.length_miles.toFixed(0)} mi</span>
                    </button>
                  ))}
                </div>
                <div className="anim-row">
                  <label className="anim-toggle">
                    <input type="checkbox" checked={animate} onChange={(e) => setAnimate(e.target.checked)} />
                    Animate construction
                  </label>
                  {animate && (
                    <button className="link" onClick={() => setReplayKey((k) => k + 1)}>
                      Replay build
                    </button>
                  )}
                </div>
              </div>
            )}

            {plan && (
              <div className="ov-block">
                <h2>Summary</h2>
                <Summary plan={plan} selected={selected} onSelect={setSelected} />
              </div>
            )}

            <p className="caveat">
              <strong>Illustrative estimates.</strong> Cost benchmarks are not calibrated. Ranges express modeled
              uncertainty, not a budget or an engineering estimate.
            </p>
          </div>
        </div>
      </section>

      <main className="app">
        {plan && route && (
          <>
            <section className="sect">
              <h2>Alternatives</h2>
              <RouteCards routes={plan.routes} selected={selected} onSelect={setSelected} />
            </section>

            <section className="sect">
              <div className="sect-head">
                <h2>Comparison</h2>
                <span className="note">Bars are scaled to the largest value in each row.</span>
              </div>
              <Comparison routes={plan.routes} selected={selected} onSelect={setSelected} />
            </section>

            <section className="sect">
              <div className="sect-head">
                <h2>Cost and schedule uncertainty</h2>
                <span className="note">
                  {route.simulation.runs.toLocaleString()} Monte Carlo runs per alternative; markers show P10, P50
                  and P90.
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
              <h3 className="subhead">
                <Num i={selected} rank={route.rank} selected={selected} /> {route.label}: distribution of runs
              </h3>
              <div className="charts">
                <DistributionChart
                  title="Capital cost"
                  dist={route.simulation.cost}
                  color={PALETTE.brown}
                  format={usd}
                  runs={route.simulation.runs}
                />
                <DistributionChart
                  title="Time to opening"
                  dist={route.simulation.duration}
                  color={PALETTE.brown}
                  format={months}
                  runs={route.simulation.runs}
                />
              </div>
              <dl className="facts">
                <div>
                  <dt>Stations</dt>
                  <dd>{route.stats.stations.join(", ")}</dd>
                </div>
                <div>
                  <dt>River crossings</dt>
                  <dd>
                    {route.stats.river_crossings} ({route.stats.river_crossings_new} new)
                  </dd>
                </div>
                <div>
                  <dt>Environmental flags</dt>
                  <dd>
                    {Object.entries(route.stats.env_flags)
                      .map(([k, v]) => `${v} ${k}`)
                      .join(", ")}
                  </dd>
                </div>
              </dl>
            </section>

            <section className="sect two">
              <div>
                <div className="sect-head">
                  <h2>Funding programs</h2>
                  <span className="note">
                    For <Num i={selected} rank={route.rank} selected={selected} /> {route.label}. Select a row for the rationale.
                  </span>
                </div>
                <FundingPanel matches={route.funding} basis={route.simulation.cost.p50} />
              </div>
              <div>
                <div className="sect-head">
                  <h2>Proposal</h2>
                  <span className="note">Drafted from the computed results only; no new numbers.</span>
                </div>
                <ProposalPanel requestId={plan.request_id} />
              </div>
            </section>

            <section className="sect notes">
              <h2>Assumptions and sources</h2>
              <div className="two">
                <ol>
                  {plan.assumptions.map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ol>
                <dl className="sources">
                  {Object.entries(plan.data_sources).map(([k, v]) => (
                    <div key={k}>
                      <dt>{k.replace(/_/g, " ")}</dt>
                      <dd>
                        {v.source}
                        {v.flag !== "real" && <em> ({v.flag})</em>}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
              <p className="note">Generated {new Date(plan.created_at).toLocaleString()}.</p>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
