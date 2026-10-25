import type { PlanResult, RouteResult } from "../api";
import { money, people, usd, years } from "../format";
import { decisionSummary } from "../summary";
import { PRIORITIES, missingPriorities, type Weights } from "../scoring";
import { list } from "../format";
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
  const missing = new Set(missingPriorities(plan.routes).map((p) => p.id));
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
        Ranked on {defaultWeights ? "the default" : "your"} priorities:{" "}
        {list(
          PRIORITIES.filter((p) => (weights[p.id] ?? 0) > 0 && !missing.has(p.id)).map((p) => p.label.toLowerCase()),
        ) || "none (all weights are zero)"}
        .{" "}
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

      <ServiceKpis r={s.leader} />

      <div className="callout">
        <h3>Service estimates are preliminary</h3>
        <p>
          {s.service ?? "No service estimate is available for this alternative."} Ridership, fares, operating cost and
          the benefit-cost ratio come from a sketch model calibrated to Amtrak's FY2024 ridership, with wide ranges.
          Reliability, line capacity and timetables are still not modeled, so a leading score does not show the service
          would be operable or fundable.{" "}
          <button className="link" onClick={() => onOpenTab("service")}>
            Service plan and estimates
          </button>
        </p>
      </div>

      <h3>Open questions</h3>
      <ul className="tight">
        {s.unresolved.map((u) => (
          <li key={u}>{u}</li>
        ))}
      </ul>
      <p className="next-step">{s.nextStep}</p>
    </section>
  );
}

/** Compact version for the map overlay: who leads, cost and opening ranges, top reasons, the main gap. */
export function HeroSummary({ plan, weights, defaultWeights, onOpenPriorities, onOpenTab }: Props) {
  const s = decisionSummary(plan, weights);
  const c = s.leader.simulation.cost;
  const d = s.leader.simulation.duration;
  return (
    <section className="hero-summary" aria-labelledby="hero-h">
      <p className="eyebrow-line">
        {plan.origin.name}, {plan.origin.state} → {plan.destination.name}, {plan.destination.state}
      </p>
      <h2 id="hero-h">
        <AltName r={s.leader} i={s.leaderIndex} /> leads under the current model and {defaultWeights ? "default" : "your"} priorities
      </h2>
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
      <p className="fine">Middle 80% of modeled outcomes; illustrative cost inputs, not a budget.</p>
      <ul className="tight hero-reasons">
        {s.reasons.slice(0, 2).map((r) => (
          <li key={r}>{r[0].toUpperCase() + r.slice(1)}.</li>
        ))}
      </ul>
      {s.leader.service?.available && s.leader.service.riders && s.leader.service.subsidy ? (
        <p className="hero-gap">
          <strong>Preliminary service estimate:</strong> {s.leader.service.round_trips} trains a day each way, about{" "}
          {people(s.leader.service.riders.p50)} riders a year ({people(s.leader.service.riders.p10)}–
          {people(s.leader.service.riders.p90)}), operating subsidy {money(s.leader.service.subsidy.p50)} a year. Reliability
          and capacity are not modeled.
        </p>
      ) : (
        <p className="hero-gap">No service estimate is available for this alternative.</p>
      )}
      <div className="row">
        <button className="link" onClick={() => onOpenTab("overview")}>
          Full summary
        </button>
        <button className="link" onClick={onOpenPriorities}>
          Adjust priorities
        </button>
      </div>
    </section>
  );
}

/** Riders and operating subsidy for an alternative, with their ranges (preliminary model estimates). */
export function ServiceKpis({ r }: { r: RouteResult }) {
  const sv = r.service;
  if (!sv || !sv.available || !sv.riders || !sv.subsidy) return null;
  return (
    <>
      <dl className="kpis">
        <div>
          <dt>Annual riders (median)</dt>
          <dd>
            <span className="kpi">{people(sv.riders.p50)}</span>
            <span className="kpi-range">
              {people(sv.riders.p10)}–{people(sv.riders.p90)}
            </span>
          </dd>
        </div>
        <div>
          <dt>Annual operating subsidy (median)</dt>
          <dd>
            <span className="kpi">{money(sv.subsidy.p50)}</span>
            <span className="kpi-range">
              {money(sv.subsidy.p10)} to {money(sv.subsidy.p90)}
            </span>
          </dd>
        </div>
      </dl>
      <p className="fine">
        Preliminary estimates for {sv.round_trips} trains a day each way. A negative subsidy is an operating surplus.
      </p>
    </>
  );
}
