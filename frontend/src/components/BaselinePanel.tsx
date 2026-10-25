import { useEffect, useState } from "react";
import { api, type PlanResult } from "../api";
import { usd, years } from "../format";
import type { Scenario } from "../scenario";
import { DEFAULT_WEIGHTS, PRIORITIES, explainChange, rank, type Weights } from "../scoring";

interface Props {
  baseline: Scenario;
  plan: PlanResult;
  weights: Weights;
  selected: number;
  onClose: () => void;
}

const share = (w: Weights, id: string) => {
  const t = PRIORITIES.reduce((a, p) => a + (w[p.id] ?? 0), 0) || 1;
  return Math.round((100 * (w[id] ?? 0)) / t);
};

// Side-by-side of the current scenario and a saved one. The saved plan is reloaded from the API
// (stored results), so both columns use the same model version when available.
export default function BaselinePanel({ baseline, plan, weights, selected, onClose }: Props) {
  const [base, setBase] = useState<PlanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bw = { ...DEFAULT_WEIGHTS, ...baseline.w };

  useEffect(() => {
    setBase(null);
    setError(null);
    api
      .plan(baseline.from, baseline.to)
      .then(setBase)
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load the saved scenario"));
  }, [baseline.from, baseline.to]);

  const sameCorridor = base && base.origin.id === plan.origin.id && base.destination.id === plan.destination.id;
  const cur = plan.routes[rank(plan.routes, weights)[0].index];
  const old = base ? base.routes[rank(base.routes, bw)[0].index] : null;
  const oldSel = base?.routes.find((r) => r.key === baseline.sel);
  const change = sameCorridor ? explainChange(plan.routes, bw, weights) : null;

  return (
    <section className="panel baseline" aria-labelledby="base-h">
      <header className="prio-head">
        <h3 id="base-h">Compared with saved scenario: {baseline.name}</h3>
        <button className="ghost" onClick={onClose}>
          Close comparison
        </button>
      </header>
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {!base && !error && <p role="status">Loading the saved scenario…</p>}
      {base && old && (
        <>
          <table className="data">
            <thead>
              <tr>
                <th scope="col">
                  <span className="sr-only">Item</span>
                </th>
                <th scope="col">Saved ({new Date(baseline.savedAt).toLocaleDateString()})</th>
                <th scope="col">Current</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Corridor</th>
                <td>
                  {base.origin.name} → {base.destination.name}
                </td>
                <td>
                  {plan.origin.name} → {plan.destination.name}
                </td>
              </tr>
              {PRIORITIES.map((p) => (
                <tr key={p.id} className={share(bw, p.id) !== share(weights, p.id) ? "changed" : ""}>
                  <th scope="row">{p.label}</th>
                  <td className="num">{share(bw, p.id)}%</td>
                  <td className="num">{share(weights, p.id)}%</td>
                </tr>
              ))}
              <tr>
                <th scope="row">Leads under its priorities</th>
                <td>{old.label}</td>
                <td>{cur.label}</td>
              </tr>
              <tr>
                <th scope="row">Leader's median capital cost</th>
                <td className="num">
                  {usd(old.simulation.cost.p50)} <span className="muted">({usd(old.simulation.cost.p10)}–{usd(old.simulation.cost.p90)})</span>
                </td>
                <td className="num">
                  {usd(cur.simulation.cost.p50)} <span className="muted">({usd(cur.simulation.cost.p10)}–{usd(cur.simulation.cost.p90)})</span>
                </td>
              </tr>
              <tr>
                <th scope="row">Leader's median time to opening</th>
                <td className="num">{years(old.simulation.duration.p50)}</td>
                <td className="num">{years(cur.simulation.duration.p50)}</td>
              </tr>
              <tr>
                <th scope="row">Selected alternative</th>
                <td>{oldSel?.label ?? "—"}</td>
                <td>{plan.routes[selected].label}</td>
              </tr>
              <tr>
                <th scope="row">Model version</th>
                <td>{base.model_version || "unknown"}</td>
                <td>{plan.model_version || "unknown"}</td>
              </tr>
            </tbody>
          </table>
          {change && <p className="change-note">{change}</p>}
          {sameCorridor && !change && old.key === cur.key && (
            <p className="fine">The same alternative leads in both scenarios.</p>
          )}
        </>
      )}
    </section>
  );
}
