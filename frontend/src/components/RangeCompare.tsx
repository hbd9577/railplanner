import type { Distribution, RouteResult } from "../api";
import { ROUTE_COLORS } from "../format";

interface Props {
  title: string;
  routes: RouteResult[];
  pick: (r: RouteResult) => Distribution;
  format: (v: number) => string;
  selected: number;
  onSelect: (idx: number) => void;
}

// P10-P90 range bars on one shared axis, with a distinct mark and value for each percentile.
export default function RangeCompare({ title, routes, pick, format, selected, onSelect }: Props) {
  const lo = Math.min(...routes.map((r) => pick(r).p10));
  const hi = Math.max(...routes.map((r) => pick(r).p90));
  const pad = (hi - lo) * 0.06 || 1;
  const x = (v: number) => ((v - (lo - pad)) / (hi - lo + 2 * pad)) * 100;

  return (
    <div className="range-compare">
      <div className="range-head">
        <span className="range-title">{title}</span>
        <span className="range-cols">
          <span>P10</span>
          <span>P50</span>
          <span>P90</span>
        </span>
      </div>
      {routes.map((r, i) => {
        const d = pick(r);
        const color = ROUTE_COLORS[i];
        return (
          <button key={r.key} className={`range-row ${i === selected ? "sel" : ""}`} onClick={() => onSelect(i)}>
            <span className="swatch" style={{ background: color }}>
              {r.rank}
            </span>
            <span className="range-track">
              <span
                className="range-bar"
                style={{ left: `${x(d.p10)}%`, width: `${x(d.p90) - x(d.p10)}%`, background: color }}
              />
              <span className="range-end" style={{ left: `${x(d.p10)}%`, borderColor: color }} />
              <span className="range-end" style={{ left: `${x(d.p90)}%`, borderColor: color }} />
              <span className="range-mid" style={{ left: `${x(d.p50)}%`, background: color }} />
            </span>
            <span className="range-cols values">
              <span>{format(d.p10)}</span>
              <strong>{format(d.p50)}</strong>
              <span>{format(d.p90)}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
