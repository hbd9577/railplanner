import { useEffect, useMemo, useState } from "react";
import { api, type City, type DemoPair, type PlanResult } from "./api";
import Comparison from "./components/Comparison";
import DistributionChart from "./components/DistributionChart";
import FundingPanel from "./components/FundingPanel";
import MapView from "./components/MapView";
import ProposalPanel from "./components/ProposalPanel";
import RangeCompare from "./components/RangeCompare";
import { ROUTE_COLORS, months, usd, years } from "./format";

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
    if (originId == null || (originId != null && destId != null)) {
      setOriginId(id);
      setDestId(null);
    } else if (id !== originId) {
      setDestId(id);
    }
  }

  const route = plan?.routes[selected];
  const cityById = useMemo(() => new Map(cities.map((c) => [c.id, c])), [cities]);
  const sorted = useMemo(() => [...cities].sort((a, b) => a.name.localeCompare(b.name)), [cities]);
  const canPlan = originId != null && destId != null && originId !== destId && loading == null;
  const planMatches = plan && plan.origin.id === originId && plan.destination.id === destId;

  return (
    <div className="app">
      <header className="top">
        <div>
          <h1>RailPlanner</h1>
          <p className="tagline">Decision support for new US passenger rail corridors</p>
        </div>
        <div className="banner" role="note">
          <span aria-hidden>⚠</span>
          <span>
            <strong>Illustrative estimates.</strong> Cost benchmarks are not calibrated; ranges show uncertainty, not
            a budget.
          </span>
        </div>
      </header>

      {error && (
        <div className="notice" role="alert">
          {error}
        </div>
      )}

      <section className="layout">
        <aside className="side">
          <div className="card">
            <h2>Corridor</h2>
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
            <p className="muted small">Or click two cities on the map.</p>
            <div className="row">
              <button className="primary" disabled={!canPlan} onClick={() => runPlan(originId!, destId!)}>
                {loading === "plan" ? (
                  <>
                    <span className="spinner" /> Planning…
                  </>
                ) : (
                  "Plan corridor"
                )}
              </button>
              {planMatches && (
                <button disabled={loading != null} onClick={() => runPlan(originId!, destId!, true)} title="Recompute routes and 5,000 simulations per route">
                  Recompute
                </button>
              )}
            </div>
            {plan && (
              <p className="muted small">
                {plan.cached ? "Loaded stored results" : "Computed now"}
                {route && ` · ${route.simulation.runs.toLocaleString()} runs per route`}
                {route && (route.simulation.source === "tiger_cagg" ? " · from Tiger Data" : " · computed locally")}
              </p>
            )}
          </div>

          {plan && (
            <div className="card">
              <h2>Compare alternatives</h2>
              <Comparison routes={plan.routes} selected={selected} onSelect={setSelected} />
              <p className="muted small">Bold = best in row. Click a column or a route on the map to focus it.</p>
            </div>
          )}
        </aside>

        <div className="map-wrap">
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
              <span className="spinner dark" /> {loading === "boot" ? "Loading…" : "Generating routes and running simulations…"}
            </div>
          )}
          {plan && (
            <div className="legend">
              {plan.routes.map((r, i) => (
                <button key={r.key} className={i === selected ? "on" : ""} onClick={() => setSelected(i)}>
                  <span className="swatch" style={{ background: ROUTE_COLORS[i] }}>
                    {r.rank}
                  </span>
                  {r.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      {plan && route && (
        <>
          <section className="card">
            <div className="section-head">
              <h2>
                Cost &amp; schedule:{" "}
                <span className="route-name">
                  <span className="swatch" style={{ background: ROUTE_COLORS[selected] }}>
                    {route.rank}
                  </span>
                  {route.label}
                </span>
              </h2>
              <p className="muted small">{route.description}</p>
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
                title="Schedule to opening"
                routes={plan.routes}
                pick={(r) => r.simulation.duration}
                format={years}
                selected={selected}
                onSelect={setSelected}
              />
            </div>
            <div className="charts">
              <DistributionChart
                title="Capital cost distribution"
                dist={route.simulation.cost}
                color={ROUTE_COLORS[selected]}
                format={usd}
                runs={route.simulation.runs}
              />
              <DistributionChart
                title="Schedule distribution"
                dist={route.simulation.duration}
                color={ROUTE_COLORS[selected]}
                format={months}
                runs={route.simulation.runs}
              />
            </div>
            <p className="muted small">
              Stations: {route.stats.stations.join(", ")} · {route.stats.river_crossings} river crossings ·{" "}
              {Object.entries(route.stats.env_flags)
                .map(([k, v]) => `${v} ${k}`)
                .join(", ")}{" "}
              flag entries
            </p>
          </section>

          <section className="grid2">
            <div className="card">
              <h2>Funding programs</h2>
              <p className="muted small">
                Rule-based matches for route {route.rank}; cost shares at the P50 cost. Program parameters are
                approximate.
              </p>
              <FundingPanel matches={route.funding} />
            </div>
            <div className="card">
              <h2>Proposal</h2>
              <p className="muted small">
                Drafted by Gemini from the computed results only. It cannot introduce new numbers.
              </p>
              <ProposalPanel requestId={plan.request_id} />
            </div>
          </section>

          <section className="card assumptions">
            <h2>Assumptions &amp; data sources</h2>
            <ul>
              {plan.assumptions.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
            <ul className="sources">
              {Object.entries(plan.data_sources).map(([k, v]) => (
                <li key={k}>
                  <strong>{k.replace(/_/g, " ")}:</strong> {v.source} <span className="tag">{v.flag}</span>
                </li>
              ))}
            </ul>
            <p className="muted small">
              {cityById.get(plan.origin.id)?.name} → {cityById.get(plan.destination.id)?.name} · generated{" "}
              {new Date(plan.created_at).toLocaleString()}
            </p>
          </section>
        </>
      )}
    </div>
  );
}
