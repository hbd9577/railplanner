import type { PlanResult } from "../api";
import { years, usd } from "../format";
import { decisionSummary } from "../summary";
import type { Weights } from "../scoring";
import { AltName } from "./ui";

interface Props {
  plan: PlanResult;
  weights: Weights;
  defaultWeights: boolean;
  onOpenPriorities: () => void;
  onOpenTab: (tab: string) => void;
}

export default function DecisionSummary({ plan, weights, defaultWeights, onOpenPriorities, onOpenTab }: Props) {
  const s = decisionSummary(plan, weights);
  const c = s.leader.simulation.cost;
  const d = s.leader.simulation.duration;
  return (
    <section className="summary-panel" aria-labelledby="summary-h">
      <p className="eyebrow-line">
        {plan.origin.name}, {plan.origin.state} → {plan.destination.name}, {plan.destination.state}
      </p>
      <h2 id="summary-h">
        <AltName r={s.leader} i={s.leaderIndex} /> leads under the current model
      </h2>
      <p className="qualifier">
        Ranked on {defaultWeights ? "the default" : "your"} priorities: capital cost, delivery time, residents near
        stations and new track in flagged areas.{" "}
        <button className="link" onClick={onOpenPriorities}>
          Adjust priorities
        </button>
      </p>

      <dl className="kpis">
        <div>
          <dt>Median capital cost</dt>
          <dd>
            <span className="kpi">{usd(c.p50)}</span>
            <span className="kpi-range">
              {usd(c.p10)}–{usd(c.p90)}
            </span>
          </dd>
        </div>
        <div>
          <dt>Median time to opening</dt>
          <dd>
            <span className="kpi">{years(d.p50)}</span>
            <span className="kpi-range">
              {years(d.p10)}–{years(d.p90)}
            </span>
          </dd>
        </div>
      </dl>
      <p className="fine">
        Ranges are the middle 80% (P10–P90) of {s.leader.simulation.runs.toLocaleString()} modeled outcomes using illustrative cost inputs. They are not a
        budget.
      </p>

      <h3>Why it leads</h3>
      <ul className="tight">
        {s.reasons.map((r) => (
          <li key={r}>{r[0].toUpperCase() + r.slice(1)}.</li>
        ))}
      </ul>

      {s.tradeoffs.length > 0 && (
        <>
          <h3>Main tradeoff</h3>
          <ul className="tight">
            {s.tradeoffs.map((t) => (
              <li key={t}>{t}.</li>
            ))}
          </ul>
        </>
      )}

      <div className="callout">
        <h3>Service not yet modeled</h3>
        <p>
          Frequency, travel time, ridership, capacity and operating subsidy are not estimated. A leading score here
          does not show that the service would be useful, operable, fundable or feasible.{" "}
          <button className="link" onClick={() => onOpenTab("service")}>
            What is missing
          </button>
        </p>
      </div>

      <h3>Open feasibility questions</h3>
      <ul className="tight">
        {s.unresolved.slice(1).map((u) => (
          <li key={u}>{u}</li>
        ))}
      </ul>
      <p className="next-step">{s.nextStep}</p>
    </section>
  );
}
