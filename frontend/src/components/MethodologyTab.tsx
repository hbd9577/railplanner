import type { PlanResult } from "../api";
import { METRICS, NOT_MODELED, STATUS_HELP, STATUS_LABEL, type Status } from "../metrics";
import type { Weights } from "../scoring";
import PrioritiesPanel from "./PrioritiesPanel";
import { Direction, StatusChip } from "./ui";

interface Props {
  plan: PlanResult;
  weights: Weights;
  onWeights: (w: Weights) => void;
}

const STATUSES: Status[] = ["calculated", "approximate", "estimate", "rule-based", "not-modeled"];

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
        <h3>Measures</h3>
        <div className="table-wrap">
          <table className="data registry">
            <thead>
              <tr>
                <th scope="col">Measure</th>
                <th scope="col">Definition</th>
                <th scope="col">Status</th>
                <th scope="col">Source and year</th>
                <th scope="col">Coverage</th>
                <th scope="col">Method</th>
              </tr>
            </thead>
            <tbody>
              {METRICS.map((m) => (
                <tr key={m.id}>
                  <th scope="row">
                    {m.label}
                    <span className="m-meta">
                      <Direction d={m.direction} />
                    </span>
                  </th>
                  <td>{m.definition}</td>
                  <td>{STATUS_LABEL[m.status]}</td>
                  <td>
                    {m.source}
                    <span className="muted"> · {m.dataYear}</span>
                  </td>
                  <td>{m.coverage}</td>
                  <td>{m.method}</td>
                </tr>
              ))}
              {NOT_MODELED.map((g) => (
                <tr key={g.id} className="gap-row">
                  <th scope="row">{g.label}</th>
                  <td>{g.why}</td>
                  <td>{STATUS_LABEL["not-modeled"]}</td>
                  <td colSpan={3} className="muted">
                    Needs: {g.needs}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

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
                  {v.flag !== "real" && <span className="chip chip-approximate">{v.flag}</span>}
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
