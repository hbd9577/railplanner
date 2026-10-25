import type { RouteResult } from "../api";
import { METRIC } from "../metrics";
import { DEFAULT_WEIGHTS, PRIORITIES, UNAVAILABLE_PRIORITIES, explainChange, rank, weightsEqual, type Weights } from "../scoring";
import { AltName } from "./ui";

interface Props {
  routes: RouteResult[];
  weights: Weights;
  onChange: (w: Weights) => void;
  onClose?: () => void;
}

// Adjustable weights with a live ranking. The composite is a relative preference score for these
// alternatives only; it is not a benefit-cost ratio and does not indicate feasibility.
export default function PrioritiesPanel({ routes, weights, onChange, onClose }: Props) {
  const ranked = rank(routes, weights);
  const total = PRIORITIES.reduce((a, p) => a + (weights[p.id] ?? 0), 0);
  const change = explainChange(routes, DEFAULT_WEIGHTS, weights);
  const isDefault = weightsEqual(weights, DEFAULT_WEIGHTS);

  return (
    <section className="priorities" id="priorities" aria-labelledby="prio-h">
      <header className="prio-head">
        <h2 id="prio-h">Priorities</h2>
        <div className="row">
          <button onClick={() => onChange({ ...DEFAULT_WEIGHTS })} disabled={isDefault}>
            Reset to defaults
          </button>
          {onClose && (
            <button className="ghost" onClick={onClose}>
              Close
            </button>
          )}
        </div>
      </header>
      <div className="prio-grid">
        <div>
          {PRIORITIES.map((p) => {
            const w = weights[p.id] ?? 0;
            return (
              <div key={p.id} className="slider">
                <label htmlFor={`w-${p.id}`}>
                  <span>{p.label}</span>
                  <span className="num-cell">{total ? Math.round((100 * w) / total) : 0}% of weight</span>
                </label>
                <input
                  id={`w-${p.id}`}
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={w}
                  onChange={(e) => onChange({ ...weights, [p.id]: Number(e.target.value) })}
                />
                <span className="fine">{p.help}</span>
              </div>
            );
          })}
          <div className="unavailable">
            <h3>Not available until modeled</h3>
            <ul className="tight">
              {UNAVAILABLE_PRIORITIES.map((u) => (
                <li key={u.label}>
                  <span className="muted-strong">{u.label}</span>: {u.why}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div>
          <h3>Ranking with these priorities</h3>
          <table className="data">
            <thead>
              <tr>
                <th scope="col">Alternative</th>
                <th scope="col" className="num">Score</th>
                {PRIORITIES.filter((p) => (weights[p.id] ?? 0) > 0).map((p) => (
                  <th key={p.id} scope="col" className="num">
                    {METRIC[p.metric].short ?? METRIC[p.metric].label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ranked.map((x, k) => (
                <tr key={x.index}>
                  <th scope="row">
                    <span className="rank-pos">{k + 1}</span> <AltName r={routes[x.index]} i={x.index} />
                  </th>
                  <td className="num strong">{x.score.toFixed(0)}</td>
                  {PRIORITIES.filter((p) => (weights[p.id] ?? 0) > 0).map((p) => (
                    <td key={p.id} className="num">
                      {x.contributions[p.id].toFixed(0)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {total === 0 && <p className="notice">All weights are zero, so every alternative ties.</p>}
          {change && <p className="change-note">{change}</p>}
          {ranked.length > 1 && ranked[0].score - ranked[1].score < 3 && (
            <p className="change-note">The top two are within 3 points: treat this as a tie.</p>
          )}
          <p className="fine">
            How the score works: for each priority, the best alternative on that measure gets full points and the
            others get points in proportion (best ÷ value for lower-is-better, value ÷ best for higher-is-better). Points
            are then weighted and summed to 100. Scores are relative to these alternatives only. The score is a way to
            express preferences, not a benefit-cost ratio, and it does not show that any alternative is feasible,
            eligible for funding or worth building. Only one population measure is used, to avoid counting residents
            twice; new track partly overlaps with cost, so it is off by default.
          </p>
        </div>
      </div>
    </section>
  );
}
