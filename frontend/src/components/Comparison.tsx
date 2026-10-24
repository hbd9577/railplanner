import type { RouteResult } from "../api";
import { ROUTE_COLORS, people, usd, years } from "../format";

interface Props {
  routes: RouteResult[];
  selected: number;
  onSelect: (idx: number) => void;
}

interface Row {
  label: string;
  hint?: string;
  value: (r: RouteResult) => number;
  format: (v: number) => string;
  best: "max" | "min";
}

interface Group {
  name: string;
  rows: Row[];
}

const GROUPS: Group[] = [
  {
    name: "Benefit",
    rows: [
      { label: "Composite score", hint: "0-100", value: (r) => r.stats.score, format: (v) => v.toFixed(1), best: "max" },
      { label: "Population served", hint: "within 10 mi", value: (r) => r.stats.population_served, format: people, best: "max" },
      { label: "Stations served", value: (r) => r.stats.stations.length, format: (v) => `${v}`, best: "max" },
    ],
  },
  {
    name: "Alignment",
    rows: [
      { label: "Length", value: (r) => r.stats.length_miles, format: (v) => `${v.toFixed(0)} mi`, best: "min" },
      { label: "On existing rail ROW", value: (r) => r.stats.row_reuse_pct, format: (v) => `${v.toFixed(1)}%`, best: "max" },
      { label: "Mean terrain slope", value: (r) => r.stats.mean_slope_pct, format: (v) => `${v.toFixed(1)}%`, best: "min" },
      { label: "Environmental flags", hint: "entries", value: (r) => r.stats.env_flag_count, format: (v) => `${v}`, best: "min" },
      { label: "River crossings", value: (r) => r.stats.river_crossings, format: (v) => `${v}`, best: "min" },
    ],
  },
  {
    name: "Cost & schedule",
    rows: [
      { label: "Capital cost", hint: "P50", value: (r) => r.simulation.cost.p50, format: usd, best: "min" },
      { label: "Cost spread", hint: "P90 − P10", value: (r) => r.simulation.cost.p90 - r.simulation.cost.p10, format: usd, best: "min" },
      { label: "Time to opening", hint: "P50", value: (r) => r.simulation.duration.p50, format: years, best: "min" },
    ],
  },
];

// Every value gets its own bar (scaled to the row's max) so magnitudes compare at a glance;
// the best value in each row is marked in text, not color alone.
export default function Comparison({ routes, selected, onSelect }: Props) {
  return (
    <div className="table-scroll">
      <table className="compare">
        <thead>
          <tr>
            <th scope="col">Measure</th>
            {routes.map((r, i) => (
              <th key={r.key} scope="col" data-selected={i === selected}>
                <button className="route-head" onClick={() => onSelect(i)} aria-pressed={i === selected}>
                  <span className="num" style={{ borderColor: ROUTE_COLORS[i] }} aria-hidden="true">
                    {r.rank}
                  </span>
                  <span>{r.label}</span>
                </button>
              </th>
            ))}
          </tr>
        </thead>
        {GROUPS.map((g) => (
          <tbody key={g.name}>
            <tr className="group">
              <th colSpan={routes.length + 1} scope="colgroup">
                {g.name}
              </th>
            </tr>
            {g.rows.map((row) => {
              const vals = routes.map(row.value);
              const max = Math.max(...vals.map(Math.abs)) || 1;
              const best = row.best === "max" ? Math.max(...vals) : Math.min(...vals);
              const tie = vals.filter((v) => v === best).length === vals.length;
              return (
                <tr key={row.label}>
                  <th scope="row">
                    {row.label}
                    {row.hint && <span className="hint">{row.hint}</span>}
                  </th>
                  {vals.map((v, i) => (
                    <td key={i} data-selected={i === selected}>
                      <div className="cell">
                        <span className="cell-val">
                          {row.format(v)}
                          {v === best && !tie && <span className="best">best</span>}
                        </span>
                        <span className="cell-bar" aria-hidden="true">
                          <span style={{ width: `${(Math.abs(v) / max) * 100}%`, background: ROUTE_COLORS[i] }} />
                        </span>
                      </div>
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        ))}
      </table>
    </div>
  );
}
