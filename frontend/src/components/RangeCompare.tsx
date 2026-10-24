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

// P10-P90 range bars on one shared axis so the alternatives compare at a glance.
export default function RangeCompare({ title, routes, pick, format, selected, onSelect }: Props) {
  const lo = Math.min(...routes.map((r) => pick(r).p10));
  const hi = Math.max(...routes.map((r) => pick(r).p90));
  const pad = (hi - lo) * 0.08 || 1;
  const x = (v: number) => `${((v - (lo - pad)) / (hi - lo + 2 * pad)) * 100}%`;

  return (
    <div className="range-compare">
      <div className="range-title">{title} (P10 – P50 – P90)</div>
      {routes.map((r, i) => {
        const d = pick(r);
        return (
          <button key={r.key} className={`range-row ${i === selected ? "sel" : ""}`} onClick={() => onSelect(i)}>
            <span className="range-label">
              <span className="swatch" style={{ background: ROUTE_COLORS[i] }}>
                {r.rank}
              </span>
            </span>
            <span className="range-track">
              <span
                className="range-bar"
                style={{ left: x(d.p10), width: `calc(${x(d.p90)} - ${x(d.p10)})`, background: ROUTE_COLORS[i] }}
              />
              <span className="range-p50" style={{ left: x(d.p50) }} />
            </span>
            <span className="range-text">
              {format(d.p10)} – <strong>{format(d.p50)}</strong> – {format(d.p90)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
