import type { PlanResult } from "../api";
import { METRICS, NOT_MODELED, STATUS_HELP, type Status } from "../metrics";
import type { Weights } from "../scoring";
import PrioritiesPanel from "./PrioritiesPanel";
import ServiceParametersPanel from "./ServiceParametersPanel";
import { Direction, StatusChip } from "./ui";

interface Props {
  plan: PlanResult;
  weights: Weights;
  onWeights: (w: Weights) => void;
}

const STATUSES: Status[] = ["observed", "assumption", "estimate", "screening", "not-modeled", "unavailable"];

export default function MethodologyTab({ plan, weights, onWeights }: Props) {
  const sim = plan.routes[0]?.simulation;
  return (
    <div className="tab-body">
      <header className="tab-head">
        <div>
          <h2>Methodology and sources</h2>
          <p className="lede">
            How each figure is produced, how reliable it is, and how the ranking is formed. Every measure in the app
            carries one of these labels.
          </p>
        </div>
      </header>

      <section className="panel">
        <h3>What the labels mean</h3>
        <dl className="status-legend">
          {STATUSES.map((s) => (
            <div key={s}>
              <dt>
                <StatusChip status={s} />
              </dt>
              <dd>{STATUS_HELP[s]}</dd>
            </div>
          ))}
        </dl>
      </section>

      <PrioritiesPanel routes={plan.routes} weights={weights} onChange={onWeights} />

      <section className="panel">
        <h3>Measures and their provenance</h3>
        <p className="fine">Open a measure to see how it is produced and what it cannot tell you.</p>
        <div className="registry-list">
          {METRICS.map((m) => (
            <details key={m.id} className="registry-item">
              <summary>
                <span className="reg-name">{m.label}</span>
                <StatusChip status={m.status} />
                <Direction d={m.direction} />
              </summary>
              <p>{m.definition}</p>
              <dl className="prov">
                {([
                  ["Units", m.unit],
                  ["Source", m.source],
                  ["Data year", m.dataYear],
                  ["Coverage", m.coverage],
                  ["Method", m.method],
                  ["Key assumptions", m.assumptions],
                  ["Uncertainty", m.uncertainty],
                  ["Known limitations", m.limitations],
                ] as const).map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
            </details>
          ))}
          {NOT_MODELED.map((g) => (
            <details key={g.id} className="registry-item gap">
              <summary>
                <span className="reg-name">{g.label}</span>
                <StatusChip status="not-modeled" />
              </summary>
              <p>{g.why}</p>
              <p className="muted">Inputs needed: {g.needs}</p>
            </details>
          ))}
        </div>
        <p className="fine">
          RailPlanner does not give numerical confidence scores: there is no validated method to derive them from
          these inputs. Status labels and the limitations above are the honest substitute.
        </p>
      </section>

      <ServiceParametersPanel />

      <div className="two-col">
        <section className="panel">
          <h3>Model assumptions</h3>
          <ol className="tight">
            {plan.assumptions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ol>
        </section>
        <section className="panel">
          <h3>Data sources</h3>
          <dl className="sources">
            {Object.entries(plan.data_sources).map(([k, v]) => (
              <div key={k}>
                <dt>{k.replace(/_/g, " ")}</dt>
                <dd>
                  {v.source}
                  {v.flag !== "real" && <span className="chip chip-screening">{v.flag}</span>}
                </dd>
              </div>
            ))}
          </dl>
          <h3>This run</h3>
          <dl className="sources">
            <div>
              <dt>Model version</dt>
              <dd>{plan.model_version || "unknown"}</dd>
            </div>
            <div>
              <dt>Simulations</dt>
              <dd>
                {sim?.runs.toLocaleString()} per alternative,{" "}
                {sim?.source === "tiger_cagg" ? "summarized in Tiger Data (TimescaleDB)" : "summarized locally"}
              </dd>
            </div>
            <div>
              <dt>Generated</dt>
              <dd>{new Date(plan.created_at).toLocaleString()}</dd>
            </div>
          </dl>
        </section>
      </div>
    </div>
  );
}
