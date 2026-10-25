import type { RouteResult } from "../api";
import { altStyle, hm, money, people, pct, usd, years } from "../format";
import { gainGiveUp } from "../summary";
import { AltName } from "./ui";

interface Props {
  routes: RouteResult[];
  selected: number;
  leader: number;
  onSelect: (i: number) => void;
}

// Concise cards: identity, what it is, headline figures, and what it gains / gives up.
export default function AltCards({ routes, selected, leader, onSelect }: Props) {
  return (
    <div className="alt-cards" role="list">
      {routes.map((r, i) => {
        const { gain, give } = gainGiveUp(routes, i);
        const sel = i === selected;
        return (
          <article
            key={r.key}
            role="listitem"
            className={`alt-card${sel ? " sel" : ""}`}
            style={{ "--c": altStyle(i).color } as React.CSSProperties}
          >
            <header>
              <button className="alt-card-title" onClick={() => onSelect(i)} aria-pressed={sel}>
                <AltName r={r} i={i} withLine />
              </button>
              <span className="tags">
                {i === leader && <span className="tag tag-lead">Leads under current priorities</span>}
                {sel && <span className="tag tag-sel">Selected</span>}
              </span>
            </header>
            <p className="alt-desc">{r.description}</p>
            <dl className="mini">
              <div>
                <dt>Capital cost</dt>
                <dd>{usd(r.simulation.cost.p50)}</dd>
              </div>
              <div>
                <dt>Opening</dt>
                <dd>{years(r.simulation.duration.p50)}</dd>
              </div>
              <div>
                <dt>Train time</dt>
                <dd>{r.service?.available ? hm(r.service.end_to_end_min) : "—"}</dd>
              </div>
              <div>
                <dt>Riders a year</dt>
                <dd>{r.service?.riders ? people(r.service.riders.p50) : "—"}</dd>
              </div>
              <div>
                <dt>Subsidy a year</dt>
                <dd>{r.service?.subsidy ? money(r.service.subsidy.p50) : "—"}</dd>
              </div>
              <div>
                <dt>On existing rail</dt>
                <dd>{pct(r.stats.row_reuse_pct)}</dd>
              </div>
            </dl>
            <div className="gg">
              <div>
                <h4>What you gain</h4>
                <ul>
                  {gain.slice(0, 2).map((g) => (
                    <li key={g}>{g[0].toUpperCase() + g.slice(1)}</li>
                  ))}
                </ul>
              </div>
              <div>
                <h4>What you give up</h4>
                <ul>
                  {give.slice(0, 2).map((g) => (
                    <li key={g}>{g[0].toUpperCase() + g.slice(1)}</li>
                  ))}
                </ul>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
