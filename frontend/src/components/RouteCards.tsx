import type { RouteResult } from "../api";
import { badgeStyle, people, routeColor, usd, years } from "../format";

interface Props {
  routes: RouteResult[];
  selected: number;
  onSelect: (idx: number) => void;
}

// One spec sheet per alternative: headline figure first, then the details as label/value rows.
export default function RouteCards({ routes, selected, onSelect }: Props) {
  return (
    <div className="specs">
      {routes.map((r, i) => {
        const cost = r.simulation.cost;
        const dur = r.simulation.duration;
        return (
          <button
            key={r.key}
            className={`spec ${i === selected ? "sel" : ""}`}
            style={{ "--route": routeColor(i, selected) } as React.CSSProperties}
            onClick={() => onSelect(i)}
            aria-pressed={i === selected}
          >
            <div className="spec-name">
              <span className="num" style={badgeStyle(i, selected)}>
                {r.rank}
              </span>
              {r.label}
            </div>
            <div className="spec-lead">
              <span className="figure">{usd(cost.p50)}</span>
              <span className="figure-note">
                median cost, {usd(cost.p10)}–{usd(cost.p90)} P10–P90
              </span>
            </div>
            <dl className="spec-rows">
              <div>
                <dt>Time to opening</dt>
                <dd>
                  {years(dur.p50)} <span className="dim">({years(dur.p10)}–{years(dur.p90)})</span>
                </dd>
              </div>
              <div>
                <dt>Length</dt>
                <dd>
                  {r.stats.length_miles.toFixed(0)} mi{" "}
                  <span className="dim">({(cost.p50 / 1e6 / r.stats.length_miles).toFixed(0)} $M/mi)</span>
                </dd>
              </div>
              <div>
                <dt>Population served</dt>
                <dd>{people(r.stats.population_served)}</dd>
              </div>
              <div>
                <dt>On existing rail</dt>
                <dd>{r.stats.row_reuse_pct.toFixed(1)}%</dd>
              </div>
              <div>
                <dt>Stations</dt>
                <dd>{r.stats.stations.length}</dd>
              </div>
              <div>
                <dt>Score</dt>
                <dd>{r.stats.score.toFixed(1)}</dd>
              </div>
            </dl>
          </button>
        );
      })}
    </div>
  );
}
