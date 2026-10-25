import type { Distribution, RouteResult } from "../api";
import { altStyle } from "../format";
import { AltName } from "./ui";

interface Props {
  title: string;
  routes: RouteResult[];
  pick: (r: RouteResult) => Distribution;
  format: (v: number) => string;
  selected: number;
  onSelect: (idx: number) => void;
}

// P10–P90 ranges on one shared axis with the median marked; the numbers sit beside each bar as a table.
export default function RangeCompare({ title, routes, pick, format, selected, onSelect }: Props) {
  const lo = Math.min(...routes.map((r) => pick(r).p10));
  const hi = Math.max(...routes.map((r) => pick(r).p90));
  const pad = (hi - lo) * 0.06 || 1;
  const x = (v: number) => ((v - (lo - pad)) / (hi - lo + 2 * pad)) * 100;

  return (
    <section className="panel">
      <table className="ranges-table">
        <caption>
          <span className="cap-title">{title}</span>
          <span className="cap-note">Bar: middle 80% of modeled outcomes. Tick: median.</span>
        </caption>
        <thead>
          <tr>
            <th scope="col">Alternative</th>
            <th scope="col" className="range-col">
              <span className="sr-only">Range</span>
            </th>
            <th scope="col" className="num">P10</th>
            <th scope="col" className="num">P50</th>
            <th scope="col" className="num">P90</th>
          </tr>
        </thead>
        <tbody>
          {routes.map((r, i) => {
            const d = pick(r);
            const color = altStyle(i).color;
            return (
              <tr key={r.key} className={i === selected ? "sel" : ""}>
                <th scope="row">
                  <button className="th-btn" onClick={() => onSelect(i)} aria-pressed={i === selected}>
                    <AltName r={r} i={i} />
                  </button>
                </th>
                <td className="range-col" aria-hidden="true">
                  <span className="range-track">
                    <span className="range-bar" style={{ left: `${x(d.p10)}%`, width: `${x(d.p90) - x(d.p10)}%`, background: color }} />
                    <span className="range-mid" style={{ left: `${x(d.p50)}%` }} />
                  </span>
                </td>
                <td className="num">{format(d.p10)}</td>
                <td className="num strong">{format(d.p50)}</td>
                <td className="num">{format(d.p90)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
