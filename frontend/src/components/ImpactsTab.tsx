import type { PlanResult } from "../api";
import { count, miles, pct } from "../format";
import { METRIC, NOT_MODELED } from "../metrics";
import { AltName, MetricInfo, StatusChip } from "./ui";

interface Props {
  plan: PlanResult;
  selected: number;
  onSelect: (i: number) => void;
}

const ENV_LABEL: Record<string, string> = {
  protected: "Protected land (PAD-US GAP 1–2)",
  wetland: "Wildlife refuges (PAD-US; not a wetland inventory)",
  floodplain: "Floodplain proxy (river corridors)",
};

const label = (k: string) => ENV_LABEL[k] ?? k.replace(/_/g, " ");

export default function ImpactsTab({ plan, selected, onSelect }: Props) {
  const kinds = Array.from(new Set(plan.routes.flatMap((r) => Object.keys(r.stats.env_miles ?? {}))));
  const r = plan.routes[selected];
  return (
    <div className="tab-body">
      <header className="tab-head">
        <div>
          <h2>Infrastructure and impacts</h2>
          <p className="lede">
            Where each alignment would need new right-of-way or difficult structures, and where it passes through areas
            that would need closer environmental review. These are screening flags from coarse public layers: they say
            where to look, not how severe the impact would be.
          </p>
        </div>
      </header>

      <section className="panel">
        <h3>Track treatment</h3>
        <table className="data">
          <thead>
            <tr>
              <th scope="col">Alternative</th>
              <th scope="col" className="num">Upgrade of active rail</th>
              <th scope="col" className="num">Reactivation of inactive rail</th>
              <th scope="col" className="num">
                New track <MetricInfo m={METRIC.newTrack} />
              </th>
              <th scope="col" className="num">
                New track, mountainous <MetricInfo m={METRIC.mountain} />
              </th>
              <th scope="col" className="num">
                Major river crossings <MetricInfo m={METRIC.rivers} />
              </th>
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
                <td className="num">{miles(x.stats.miles_upgrade)}</td>
                <td className="num">{miles(x.stats.miles_reactivation)}</td>
                <td className="num">{miles(x.stats.miles_new)}</td>
                <td className="num">{miles(x.stats.miles_new_mountainous)}</td>
                <td className="num">
                  {x.stats.river_crossings} <span className="muted">({x.stats.river_crossings_new} new)</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="fine">
          Running on an existing rail corridor ({pct(r.stats.row_reuse_pct)} of {r.label}) avoids new land but does not
          mean the railroad owner grants access, has spare capacity or that the track suits passenger speeds.
        </p>
      </section>

      <section className="panel">
        <h3>
          Miles through flagged areas <StatusChip status="screening" />
        </h3>
        <table className="data">
          <thead>
            <tr>
              <th scope="col">Alternative</th>
              {kinds.map((k) => (
                <th key={k} scope="col" className="num">
                  {label(k)}
                </th>
              ))}
              <th scope="col" className="num">
                On new track, any layer <MetricInfo m={METRIC.envNew} />
              </th>
              <th scope="col" className="num">Flag entries</th>
            </tr>
          </thead>
          <tbody>
            {plan.routes.map((x, i) => (
              <tr key={x.key} className={i === selected ? "sel" : ""}>
                <th scope="row">
                  <AltName r={x} i={i} />
                </th>
                {kinds.map((k) => (
                  <td key={k} className="num">
                    {miles(x.stats.env_miles?.[k] ?? 0)}
                  </td>
                ))}
                <td className="num strong">{miles(x.stats.env_miles_new ?? 0)}</td>
                <td className="num">{x.stats.env_flag_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="fine">
          In the per-layer columns a mile inside two layers counts in both; the new-track column counts it once and leaves out existing track, which is what the ranking uses. Flag entries count how many times the path enters a flagged area; a
          count is not a measure of risk or harm. Floodplain uses river corridors as a proxy, not FEMA flood maps.
          Wetlands, endangered species habitat, historic sites and communities affected are not assessed.
        </p>
      </section>

      <section className="panel">
        <h3>
          Emissions and road safety <StatusChip status="estimate" />
        </h3>
        <table className="data">
          <thead>
            <tr>
              <th scope="col">Alternative</th>
              <th scope="col" className="num">
                CO2 avoided a year <MetricInfo m={METRIC.co2} />
              </th>
              <th scope="col" className="num">Car miles avoided a year</th>
              <th scope="col" className="num">
                Road deaths avoided a year <MetricInfo m={METRIC.fatalities} />
              </th>
            </tr>
          </thead>
          <tbody>
            {plan.routes.map((x, i) => {
              const s = x.service && x.service.available ? x.service : null;
              return (
                <tr key={x.key} className={i === selected ? "sel" : ""}>
                  <th scope="row">
                    <AltName r={x} i={i} />
                  </th>
                  {s && s.co2_tonnes && s.car_vmt_avoided && s.fatalities_avoided ? (
                    <>
                      <td className="num">
                        <span className={s.co2_tonnes.p50 < 0 ? "warn-text strong" : "strong"}>{count(s.co2_tonnes.p50)} t</span>
                        <span className="muted block">
                          {count(s.co2_tonnes.p10)} to {count(s.co2_tonnes.p90)} t
                        </span>
                      </td>
                      <td className="num">{count(s.car_vmt_avoided.p50 / 1e6, 0)} million</td>
                      <td className="num">
                        {s.fatalities_avoided.p50.toFixed(1)}
                        <span className="muted block">
                          {s.fatalities_avoided.p10.toFixed(1)} to {s.fatalities_avoided.p90.toFixed(1)}
                        </span>
                      </td>
                    </>
                  ) : (
                    <td colSpan={3} className="muted">
                      Not available
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="fine">
          Negative CO2 means the diesel trains emit more than the car trips they replace, which happens when few riders
          share each train. Electrification would change this and is not modeled. Medians with the middle 80% of
          simulations below.
        </p>
      </section>

      <section className="panel subtle">
        <h3>Not assessed</h3>
        <ul className="tight">
          {NOT_MODELED.filter((g) => g.group === "Impacts" || g.id === "capacity").map((g) => (
            <li key={g.id}>
              <strong>{g.label}.</strong> {g.why} <span className="muted">Needs: {g.needs}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
