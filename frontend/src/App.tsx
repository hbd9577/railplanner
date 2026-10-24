import { useEffect, useMemo, useState } from "react";
import { api, type City, type DemoPair, type PlanResult } from "./api";
import Comparison from "./components/Comparison";
import DistributionChart from "./components/DistributionChart";
import FundingPanel from "./components/FundingPanel";
import MapView from "./components/MapView";
import ProposalPanel from "./components/ProposalPanel";
import RangeCompare from "./components/RangeCompare";
import RouteCards from "./components/RouteCards";
import Summary from "./components/Summary";
import { ROUTE_COLORS, months, usd, years } from "./format";

function Num({ i, rank }: { i: number; rank: number }) {
  return (
    <span className="num" style={{ background: ROUTE_COLORS[i] }}>
      {rank}
    </span>
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
  const [animate, setAnimate] = useState(true);

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

      <main className="app">
        <p className="caveat">
          <strong>Illustrative estimates.</strong> Cost benchmarks are not calibrated. Ranges express modeled
          uncertainty, not a budget or an engineering estimate.
        </p>

        {error && (
          <div className="notice" role="alert">
            {error}
          </div>
        )}

        <section className="top">
          <aside className="side">
            <div className="block">
              <h2>Corridor</h2>
              <ul className="presets">
                {pairs.map((p) => (
                  <li key={p.label}>
                    <button
                      className={p.origin_id === originId && p.dest_id === destId ? "on" : ""}
                      onClick={() => runPlan(p.origin_id, p.dest_id)}
                      disabled={loading != null}
                    >
                      {p.label}
                    </button>
                  </li>
                ))}
              </ul>
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
                    disabled={loading != null}
                    onClick={() => runPlan(originId!, destId!, true)}
                    title="Recompute routes and all simulations"
                  >
                    Recompute
                  </button>
                )}
              </div>
              <p className="note">You can also pick two cities on the map.</p>
            </div>

            {plan && (
              <div className="block">
                <h2>Summary</h2>
                <Summary plan={plan} onSelect={setSelected} />
              </div>
            )}
          </aside>

          <figure className="map-frame">
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
              <div className="map-loading">
                {loading === "boot" ? "Loading…" : "Generating routes and running simulations…"}
              </div>
            )}
            {plan && (
              <div className="legend">
                {plan.routes.map((r, i) => (
                  <button key={r.key} className={i === selected ? "on" : ""} onClick={() => setSelected(i)}>
                    <span className="line" style={{ background: ROUTE_COLORS[i] }} />
                    <span>
                      {r.rank}. {r.label}
                    </span>
                    <span className="dim">{r.stats.length_miles.toFixed(0)} mi</span>
                  </button>
                ))}
                <label className="anim-toggle">
                  <input type="checkbox" checked={animate} onChange={(e) => setAnimate(e.target.checked)} />
                  Animate trains (same speed on every route)
                </label>
              </div>
            )}
          </figure>
        </section>

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
                <Num i={selected} rank={route.rank} /> {route.label}: distribution of runs
              </h3>
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
                    For <Num i={selected} rank={route.rank} /> {route.label}. Select a row for the rationale.
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
