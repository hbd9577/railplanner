import type { RouteResult } from "../api";
import { ROUTE_COLORS, people, usd, years } from "../format";

interface Props {
  routes: RouteResult[];
  selected: number;
  onSelect: (idx: number) => void;
}

interface Row {
  label: string;
  value: (r: RouteResult) => number;
  format: (v: number) => string;
  best: "max" | "min";
  hint?: string;
}

const ROWS: Row[] = [
  { label: "Score", value: (r) => r.stats.score, format: (v) => v.toFixed(1), best: "max", hint: "0-100 composite" },
  { label: "Length", value: (r) => r.stats.length_miles, format: (v) => `${v.toFixed(0)} mi`, best: "min" },
  {
    label: "Population served",
    value: (r) => r.stats.population_served,
    format: people,
    best: "max",
    hint: "within 10 mi",
  },
  { label: "Existing ROW reuse", value: (r) => r.stats.row_reuse_pct, format: (v) => `${v.toFixed(1)}%`, best: "max" },
  { label: "Env. flags crossed", value: (r) => r.stats.env_flag_count, format: (v) => `${v}`, best: "min" },
  { label: "Stations", value: (r) => r.stats.stations.length, format: (v) => `${v}`, best: "max" },
  { label: "Cost (P50)", value: (r) => r.simulation.cost.p50, format: usd, best: "min" },
  { label: "Schedule (P50)", value: (r) => r.simulation.duration.p50, format: years, best: "min" },
];

export default function Comparison({ routes, selected, onSelect }: Props) {
  return (
    <table className="compare">
      <thead>
        <tr>
          <th />
          {routes.map((r, i) => (
            <th key={r.key} className={i === selected ? "sel" : ""}>
              <button className="route-head" onClick={() => onSelect(i)} title={r.description}>
                <span className="swatch" style={{ background: ROUTE_COLORS[i] }}>
                  {r.rank}
                </span>
                <span>{r.label}</span>
              </button>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {ROWS.map((row) => {
          const vals = routes.map(row.value);
          const best = row.best === "max" ? Math.max(...vals) : Math.min(...vals);
          return (
            <tr key={row.label}>
              <th scope="row">
                {row.label}
                {row.hint && <span className="hint"> ({row.hint})</span>}
              </th>
              {vals.map((v, i) => (
                <td key={i} className={`${i === selected ? "sel" : ""} ${v === best ? "best" : ""}`}>
                  {row.format(v)}
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
