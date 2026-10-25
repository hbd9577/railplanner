import type { PlanResult } from "../api";
import { miles, people } from "../format";
import { METRIC, NOT_MODELED } from "../metrics";
import { AltName, MetricInfo, StatusChip } from "./ui";

interface Props {
  plan: PlanResult;
  selected: number;
  onSelect: (i: number) => void;
}

// What the service would be and who it could reach. Most of this is not modeled, and the tab says so first.
export default function ServiceTab({ plan, selected, onSelect }: Props) {
  const r = plan.routes[selected];
  const service = NOT_MODELED.filter((g) => g.group === "Service" || g.group === "Demand");
  return (
    <div className="tab-body">
      <header className="tab-head">
        <div>
          <h2>Service and demand</h2>
          <p className="lede">
            RailPlanner draws alignments and estimates construction. It does not yet plan a train service, so it cannot
            say how fast, how often or how full the trains would be. The measures below describe who lives near the
            line, which is a precondition for ridership, not a forecast of it.
          </p>
        </div>
      </header>

      <section className="panel callout-panel">
        <h3>Not modeled yet</h3>
        <table className="data gaps">
          <thead>
            <tr>
              <th scope="col">Measure</th>
              <th scope="col">Why it matters</th>
              <th scope="col">Inputs needed</th>
            </tr>
          </thead>
          <tbody>
            {service.map((g) => (
              <tr key={g.id}>
                <th scope="row">
                  {g.label} <StatusChip status="not-modeled" />
                </th>
                <td>{g.why}</td>
                <td className="muted">{g.needs}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <h3>Population and access</h3>
        <p className="fine">
          Three different things, often confused: <strong>population near the alignment</strong> (anyone within 10
          miles of the line, served or not), <strong>residents near stations</strong> (within {r.stats.station_catchment_km}{" "}
          km of a station, each person counted once) and <strong>ridership</strong> (trips actually taken, not
          modeled). Only residents near stations is used in the ranking, so population is not counted twice.
        </p>
        <table className="data">
          <thead>
            <tr>
              <th scope="col">Alternative</th>
              <th scope="col" className="num">
                Residents near stations <MetricInfo m={METRIC.popStations} />
              </th>
              <th scope="col" className="num">
                Residents near the alignment <MetricInfo m={METRIC.popLine} />
              </th>
              <th scope="col" className="num">Stations</th>
              <th scope="col" className="num">Ridership</th>
            </tr>
          </thead>
          <tbody>
            {plan.routes.map((x, i) => (
              <tr key={x.key} className={i === selected ? "sel" : ""}>
                <th scope="row">
                  <button className="th-btn" onClick={() => onSelect(i)} aria-pressed={i === selected}>
                    <AltName r={x} i={i} />
                  </button>
                </th>
                <td className="num">{people(x.stats.pop_near_stations)}</td>
                <td className="num">{people(x.stats.population_served)}</td>
                <td className="num">{x.stats.stations.length}</td>
                <td className="num muted">Not modeled</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="fine">
          A line can pass close to a large metro area without a station there; that population then counts near the
          alignment but not near stations. Catchments are straight-line distances, not travel times.
        </p>
      </section>

      <section className="panel">
        <h3>
          Stations on <AltName r={r} i={selected} withLine />, in route order
        </h3>
        <ol className="station-seq">
          {r.stats.station_miles.map((s, k) => (
            <li key={s.name}>
              <span className="seq-n">{k + 1}</span>
              <span className="seq-name">{s.name}</span>
              <span className="num-cell muted">mile {Math.round(s.mile).toLocaleString()}</span>
            </li>
          ))}
        </ol>
        <p className="fine">
          Stations are placed where one of RailPlanner's cities lies within 5 km of the line. Station sites, spacing and
          stopping patterns are not designed. Total alignment: {miles(r.stats.length_miles)}.
        </p>
      </section>
    </div>
  );
}
