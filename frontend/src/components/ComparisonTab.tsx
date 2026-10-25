import { useState } from "react";
import type { RouteResult } from "../api";
import { altStyle, signed } from "../format";
import { METRICS, NOT_MODELED, type Group } from "../metrics";
import { gainGiveUp } from "../summary";
import { AltName, Direction, MetricInfo, StatusChip } from "./ui";

const GROUPS: Group[] = ["Service", "Demand", "Access", "Infrastructure", "Cost", "Schedule", "Impacts", "Funding"];

interface Props {
  routes: RouteResult[];
  selected: number;
  leader: number;
  onSelect: (i: number) => void;
}

export default function ComparisonTab({ routes, selected, leader, onSelect }: Props) {
  const [baseline, setBaseline] = useState(selected);
  const base = routes[baseline] ?? routes[0];

  return (
    <div className="tab-body">
      <header className="tab-head">
        <div>
          <h2>Compare the alternatives</h2>
          <p className="lede">
            One row per measure, grouped by what it tells you. Differences are shown against the baseline you choose.
            Bars start at zero and scale to the largest value in the row, so a longer bar is not always better: check
            the preferred direction.
          </p>
        </div>
        <label className="field-inline">
          Baseline
          <select value={baseline} onChange={(e) => setBaseline(Number(e.target.value))}>
            {routes.map((r, i) => (
              <option key={r.key} value={i}>
                {r.rank}. {r.label}
              </option>
            ))}
          </select>
        </label>
      </header>

      <div className="table-wrap">
        <table className="cmp">
          <thead>
            <tr>
              <th scope="col" className="cmp-measure">
                Measure
              </th>
              {routes.map((r, i) => (
                <th key={r.key} scope="col" className={i === selected ? "sel" : ""}>
                  <button className="th-btn" onClick={() => onSelect(i)} aria-pressed={i === selected}>
                    <AltName r={r} i={i} withLine />
                  </button>
                  <span className="th-tags">
                    {i === leader && <span className="tag tag-lead">Leads</span>}
                    {i === baseline && <span className="tag">Baseline</span>}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          {GROUPS.map((g) => {
            const metrics = METRICS.filter((m) => m.group === g);
            const gaps = NOT_MODELED.filter((x) => x.group === g);
            if (!metrics.length && !gaps.length) return null;
            return (
              <tbody key={g}>
                <tr className="group-row">
                  <th colSpan={routes.length + 1} scope="colgroup">
                    {g}
                  </th>
                </tr>
                {metrics.map((m) => {
                  const vals = routes.map(m.get);
                  const finite = vals.filter(Number.isFinite);
                  const max = Math.max(...finite.map(Math.abs), 0) || 1;
                  const complete = finite.length === vals.length;
                  const best = !complete ? NaN : m.direction === "lower" ? Math.min(...vals) : Math.max(...vals);
                  const unique = vals.filter((v) => v === best).length === 1;
                  return (
                    <tr key={m.id}>
                      <th scope="row">
                        <span className="m-label">
                          {m.label} <MetricInfo m={m} />
                        </span>
                        <span className="m-meta">
                          <Direction d={m.direction} />
                          <StatusChip status={m.status} />
                        </span>
                      </th>
                      {vals.map((v, i) => (
                        <td key={i} className={i === selected ? "sel" : ""}>
                          <span className="v num-cell">
                            {m.fmt(v)}
                            {m.direction !== "context" && unique && v === best && (
                              <span className="lead-mark">{m.direction === "lower" ? "lowest" : "highest"}</span>
                            )}
                          </span>
                          {i !== baseline && Number.isFinite(v) && Number.isFinite(m.get(base)) && (
                            <span className="delta num-cell">{signed(v - m.get(base), m.fmt)} vs {base.rank}</span>
                          )}
                          <span className="bar" aria-hidden="true">
                            <span style={{ width: `${Number.isFinite(v) ? (Math.abs(v) / max) * 100 : 0}%`, background: altStyle(i).color }} />
                          </span>
                        </td>
                      ))}
                    </tr>
                  );
                })}
                {gaps.map((x) => (
                  <tr key={x.id} className="gap-row">
                    <th scope="row">
                      <span className="m-label">{x.label}</span>
                      <span className="m-meta">
                        <StatusChip status="not-modeled" />
                      </span>
                    </th>
                    <td colSpan={routes.length}>
                      <span className="gap-why">{x.why}</span> <span className="muted">Needs: {x.needs}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            );
          })}
        </table>
      </div>

      <section className="gg-grid" aria-label="What each alternative gains and gives up">
        {routes.map((r, i) => {
          const { gain, give } = gainGiveUp(routes, i);
          return (
            <article key={r.key} className="gg-card">
              <h3>
                <AltName r={r} i={i} withLine />
              </h3>
              <h4>What you gain</h4>
              <ul>
                {gain.map((x) => (
                  <li key={x}>{x[0].toUpperCase() + x.slice(1)}</li>
                ))}
              </ul>
              <h4>What you give up</h4>
              <ul>
                {give.map((x) => (
                  <li key={x}>{x[0].toUpperCase() + x.slice(1)}</li>
                ))}
              </ul>
            </article>
          );
        })}
      </section>
    </div>
  );
}
