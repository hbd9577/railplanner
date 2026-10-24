import type { RouteResult } from "../api";
import { ROUTE_COLORS, people, usd, years } from "../format";

interface Props {
  routes: RouteResult[];
  selected: number;
  onSelect: (idx: number) => void;
}

// One card per alternative: the headline numbers as stat tiles, so each figure reads on its own.
export default function RouteCards({ routes, selected, onSelect }: Props) {
  const bestScore = Math.max(...routes.map((r) => r.stats.score));
  return (
    <div className="route-cards">
      {routes.map((r, i) => {
        const color = ROUTE_COLORS[i];
        const cost = r.simulation.cost;
        const dur = r.simulation.duration;
        return (
          <button
            key={r.key}
            className={`route-card ${i === selected ? "sel" : ""}`}
            style={{ "--route": color } as React.CSSProperties}
            onClick={() => onSelect(i)}
            aria-pressed={i === selected}
          >
            <div className="rc-head">
              <span className="swatch lg" style={{ background: color }}>
                {r.rank}
              </span>
              <div className="rc-title">
                <div className="rc-name">{r.label}</div>
                <div className="rc-sub">
                  {r.stats.stations.length} stations · {r.stats.row_reuse_pct.toFixed(0)}% on existing rail
                </div>
              </div>
              <div className={`score-pill ${r.stats.score === bestScore ? "top" : ""}`} title="Composite score (0-100)">
                <span className="score-num">{r.stats.score.toFixed(1)}</span>
                <span className="score-lbl">score</span>
              </div>
            </div>
            <div className="rc-stats">
              <div className="stat">
                <div className="stat-lbl">Capital cost · P50</div>
                <div className="stat-val">{usd(cost.p50)}</div>
                <div className="stat-range">
                  {usd(cost.p10)} – {usd(cost.p90)}
                </div>
              </div>
              <div className="stat">
                <div className="stat-lbl">Time to opening · P50</div>
                <div className="stat-val">{years(dur.p50)}</div>
                <div className="stat-range">
                  {years(dur.p10)} – {years(dur.p90)}
                </div>
              </div>
              <div className="stat">
                <div className="stat-lbl">Length</div>
                <div className="stat-val">{r.stats.length_miles.toFixed(0)} mi</div>
                <div className="stat-range">{(cost.p50 / 1e6 / r.stats.length_miles).toFixed(0)} $M per mile</div>
              </div>
              <div className="stat">
                <div className="stat-lbl">Population served</div>
                <div className="stat-val">{people(r.stats.population_served)}</div>
                <div className="stat-range">within {r.stats.buffer_miles.toFixed(0)} mi</div>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
