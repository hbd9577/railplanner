import { useEffect, useMemo, useState } from "react";
import { api, type City, type PlanResult } from "./api";
import Comparison from "./components/Comparison";
import DistributionChart from "./components/DistributionChart";
import FundingPanel from "./components/FundingPanel";
import MapView from "./components/MapView";
import ProposalPanel from "./components/ProposalPanel";
import RangeCompare from "./components/RangeCompare";
import Summary from "./components/Summary";
import { ROUTE_COLORS, months, usd, years } from "./format";

function Num({ i, rank }: { i: number; rank: number }) {
  return (
    <span className="num" style={{ borderColor: ROUTE_COLORS[i] }} aria-hidden="true">
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [animate, setAnimate] = useState(true);

  useEffect(() => {
    api
      .cities()
      .then((cs) => {
        setCities(cs);
        // A shared link (?from=ID&to=ID) reopens that corridor's results.
        const q = new URLSearchParams(window.location.search);
        const o = Number(q.get("from"));
        const d = Number(q.get("to"));
        if (cs.some((c) => c.id === o) && cs.some((c) => c.id === d) && o !== d) {
          setOriginId(o);
          setDestId(d);
          runPlan(false, o, d);
        }
      })
      .catch((e) => setError(`Could not load the city list (${e.message}). Check that the API is running.`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runPlan(fresh = false, o = originId, d = destId) {
    if (o == null || d == null) return;
    setLoading(true);
    setError(null);
    try {
      setPlan(await api.plan(o, d, fresh));
      setSelected(0);
      window.history.replaceState(null, "", `?from=${o}&to=${d}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Planning failed.");
    } finally {
      setLoading(false);
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
  const canPlan = originId != null && destId != null && originId !== destId && !loading;
  const showingPair = plan && plan.origin.id === originId && plan.destination.id === destId;

  return (
    <>
      <header className="masthead">
        <div className="wrap">
          <div>
            <h1>RailPlanner</h1>
            <p>
              Compare candidate passenger rail alignments between two cities: cost and schedule ranges, population
              reach and which federal programs could fund them.
            </p>
          </div>
          {plan && route && (
            <p className="provenance">
              {route.simulation.source === "tiger_cagg" ? "Results stored in Tiger Data" : "Results computed locally"},{" "}
              {route.simulation.runs.toLocaleString()} simulations per alternative
            </p>
          )}
        </div>
      </header>

      <main className="wrap">
        <section className="planner" aria-labelledby="corridor-heading">
          <form
            className="planner-form"
            onSubmit={(e) => {
              e.preventDefault();
              runPlan();
            }}
          >
            <h2 id="corridor-heading">Choose a corridor</h2>
            <p>Pick an origin and a destination, or select two cities on the map.</p>
            <div className="field">
              <label htmlFor="origin">From</label>
              <select id="origin" value={originId ?? ""} onChange={(e) => setOriginId(Number(e.target.value) || null)}>
                <option value="">Select a city</option>
                {sorted.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}, {c.state}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="dest">To</label>
              <select id="dest" value={destId ?? ""} onChange={(e) => setDestId(Number(e.target.value) || null)}>
                <option value="">Select a city</option>
                {sorted.map((c) => (
                  <option key={c.id} value={c.id} disabled={c.id === originId}>
                    {c.name}, {c.state}
                  </option>
                ))}
              </select>
            </div>
            <div className="actions">
              <button type="submit" className="btn btn-primary" disabled={!canPlan}>
                {loading ? "Generating alternatives…" : "Generate alternatives"}
              </button>
              {showingPair && (
                <button type="button" className="btn" disabled={loading} onClick={() => runPlan(true)}>
                  Rerun simulations
                </button>
              )}
            </div>
            <p className="caveat">
              <strong>Illustrative estimates.</strong> Cost benchmarks are not calibrated. Ranges show modeled
              uncertainty, not a budget or an engineering estimate.
            </p>
            {error && (
              <p className="notice" role="alert">
                {error}
              </p>
            )}
          </form>

          <figure className="map-frame" aria-label="Map of cities and candidate alignments">
            <MapView
              cities={cities}
              plan={plan}
              originId={originId}
              destId={destId}
              selected={selected}
              animate={animate}
              onCityClick={onCityClick}
              onRouteClick={setSelected}
            />
            {loading && (
              <p className="map-status" role="status">
                Generating routes and running simulations…
              </p>
            )}
            {plan && (
              <div className="legend">
                {plan.routes.map((r, i) => (
                  <button key={r.key} aria-pressed={i === selected} onClick={() => setSelected(i)}>
                    <span className="key" style={{ background: ROUTE_COLORS[i] }} aria-hidden="true" />
                    <span>
                      {r.rank}. {r.label}
                    </span>
                    <span className="muted">{r.stats.length_miles.toFixed(0)} mi</span>
                  </button>
                ))}
                <label>
                  <input type="checkbox" checked={animate} onChange={(e) => setAnimate(e.target.checked)} />
                  Race trains at equal speed
                </label>
              </div>
            )}
          </figure>
        </section>

        {plan && route && (
          <>
            <section className="section findings" aria-labelledby="findings-heading">
              <div>
                <h2 id="findings-heading">
                  {plan.origin.name} to {plan.destination.name}
                </h2>
                <div className="section-intro">
                  <Summary plan={plan} onSelect={setSelected} />
                </div>
              </div>
              <div className="caveat-block">
                <h3>How to read these results</h3>
                <p>
                  Each alternative is a conceptual alignment on a 1 km grid. Costs and schedules come from{" "}
                  {route.simulation.runs.toLocaleString()} Monte Carlo runs; P50 is the median, P10 and P90 bound the
                  middle 80% of outcomes.
                </p>
                <p>Select an alternative anywhere on the page to focus the map and the detail below.</p>
              </div>
            </section>

            <section className="section" aria-labelledby="compare-heading">
              <h2 id="compare-heading">Compare the alternatives</h2>
              <p className="section-intro">
                Bars scale to the largest value in each row; “best” marks the leader on that measure.
              </p>
              <Comparison routes={plan.routes} selected={selected} onSelect={setSelected} />
            </section>

            <section className="section" aria-labelledby="uncertainty-heading">
              <h2 id="uncertainty-heading">Cost and schedule uncertainty</h2>
              <p className="section-intro">
                Ranges overlap when the alternatives cannot be told apart at this level of detail.
              </p>
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
              <div className="detail">
                <h3>
                  <Num i={selected} rank={route.rank} /> {route.label}
                </h3>
                <p className="section-intro">{route.description}</p>
                <div className="charts">
                  <DistributionChart
                    title="Capital cost, all runs"
                    dist={route.simulation.cost}
                    color={ROUTE_COLORS[selected]}
                    format={usd}
                    runs={route.simulation.runs}
                  />
                  <DistributionChart
                    title="Time to opening, all runs"
                    dist={route.simulation.duration}
                    color={ROUTE_COLORS[selected]}
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
                      {route.stats.river_crossings}, of which {route.stats.river_crossings_new} new
                    </dd>
                  </div>
                  <div>
                    <dt>Environmental flags entered</dt>
                    <dd>
                      {Object.entries(route.stats.env_flags)
                        .map(([k, v]) => `${v} ${k}`)
                        .join(", ")}
                    </dd>
                  </div>
                </dl>
              </div>
            </section>

            <section className="section split">
              <div>
                <h2 id="funding-heading">Federal funding fit</h2>
                <p>
                  Programs matched to alternative {route.rank}, {route.label}. Open a program to read why it fits.
                </p>
                <FundingPanel matches={route.funding} basis={route.simulation.cost.p50} />
              </div>
              <div>
                <h2 id="proposal-heading">Draft proposal</h2>
                <p>Written by Gemini from the computed results only, then checked so no new figures appear.</p>
                <ProposalPanel requestId={plan.request_id} />
              </div>
            </section>

            <section className="section" aria-labelledby="notes-heading">
              <h2 id="notes-heading">Assumptions and data sources</h2>
              <div className="notes-grid">
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
                        {v.flag !== "real" && `, ${v.flag}`}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            </section>
          </>
        )}
      </main>

      <footer className="wrap">
        <p className="caption">
          Data: BTS NTAD rail lines, 2020 Census tracts, USGS 3DEP elevation, USGS PAD-US, Natural Earth. Built for
          SBUHacks 2026.
        </p>
      </footer>
    </>
  );
}
