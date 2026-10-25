import type { RouteResult } from "../api";
import { METRIC } from "../metrics";
import { DEFAULT_WEIGHTS, PRIORITIES, UNAVAILABLE_PRIORITIES, explainChange, missingPriorities, rank, sensitivity, weightsEqual, type Weights } from "../scoring";
import { AltName, StatusChip } from "./ui";

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
  const missing = missingPriorities(routes);

  return (
    <section className="priorities" id="priorities" aria-labelledby="prio-h">
      <header className="prio-head">
        <h2 id="prio-h">
          Priorities <StatusChip status="assumption" />
        </h2>
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
          {missing.length > 0 && (
            <p className="notice">
              Left out of the ranking because a value is missing for at least one alternative:{" "}
              {missing.map((p) => p.label.toLowerCase()).join(", ")}.
            </p>
          )}
          {change && <p className="change-note">{change}</p>}
          {ranked.length > 1 && ranked[0].score - ranked[1].score < 3 && (
            <p className="change-note">The top two are within 3 points: treat this as a tie.</p>
          )}
          <h3 className="sens-h">How sensitive is the leader?</h3>
          <p className="fine">
            Moving one slider at a time (others unchanged), {routes[ranked[0].index].label} stays first while the slider is
            within the range shown.
          </p>
          <table className="data sens">
            <thead>
              <tr>
                <th scope="col">Priority</th>
                <th scope="col" className="num">Now</th>
                <th scope="col" className="num">Leader holds from–to</th>
                <th scope="col">Outside that range</th>
              </tr>
            </thead>
            <tbody>
              {sensitivity(routes, weights).map((x) => {
                const robust = x.holds[0] === 0 && x.holds[1] === 100;
                const flips = [
                  x.below != null && `below ${x.holds[0]}: ${routes[x.below].label}`,
                  x.above != null && `above ${x.holds[1]}: ${routes[x.above].label}`,
                ].filter(Boolean);
                return (
                  <tr key={x.priority.id}>
                    <th scope="row">{x.priority.label}</th>
                    <td className="num">{x.current}</td>
                    <td className="num">{robust ? "any value" : `${x.holds[0]}–${x.holds[1]}`}</td>
                    <td>{robust ? "No change" : flips.join("; ")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="fine">
            How the score works: for each priority, the best alternative on that measure gets full points and the
            others get points in proportion (best ÷ value for lower-is-better, value ÷ best for higher-is-better; a
            measure that can be negative, such as an operating surplus, is scaled linearly between the best and worst).
            Points are then weighted and summed to 100. Scores are relative to these alternatives only. The score is a
            way to express preferences, not a benefit-cost ratio, and it does not show that any alternative is
            feasible, eligible for funding or worth building. Riders and residents near stations overlap, and new track
            overlaps with capital cost, so residents and new track are off by default. Ridership, train time and
            subsidy depend on the service plan on the Service tab.
          </p>
        </div>
      </div>
    </section>
  );
}
