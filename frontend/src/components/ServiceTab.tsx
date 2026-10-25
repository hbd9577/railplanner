import { useEffect, useState } from "react";
import { DEFAULT_SERVICE, api, type DemandCalibration, type PlanResult, type ServicePlan } from "../api";
import { count, hm, money, pct, people, usd } from "../format";
import { METRIC, NOT_MODELED } from "../metrics";
import { AltName, MetricInfo, StatusChip } from "./ui";

interface Props {
  plan: PlanResult;
  selected: number;
  onSelect: (i: number) => void;
  servicePlan: ServicePlan;
  onServicePlan: (p: ServicePlan) => void;
  serviceLoading: boolean;
  serviceError: string | null;
}

const EXISTING_SPEEDS = [79, 90, 110, 125];
const NEW_SPEEDS = [110, 125, 150, 186, 220];

const range = (r: { p10: number; p50: number; p90: number } | null | undefined, f: (v: number) => string) =>
  r ? (
    <>
      <span className="strong">{f(r.p50)}</span>
      <span className="muted block">
        {f(r.p10)} to {f(r.p90)}
      </span>
    </>
  ) : (
    "Not available"
  );

export default function ServiceTab({ plan, selected, onSelect, servicePlan, onServicePlan, serviceLoading, serviceError }: Props) {
  const r = plan.routes[selected];
  const sv = r.service && r.service.available ? r.service : null;
  const [calibration, setCalibration] = useState<DemandCalibration | null>(null);
  const [showAllPairs, setShowAllPairs] = useState(false);
  useEffect(() => {
    api
      .serviceParameters()
      .then((x) => setCalibration(x.calibration))
      .catch(() => setCalibration(null));
  }, []);

  const pairs = sv ? [...sv.pairs].sort((a, b) => b.trips - a.trips) : [];
  const shown = showAllPairs ? pairs : pairs.slice(0, 12);
  const isDefault =
    servicePlan.round_trips === DEFAULT_SERVICE.round_trips &&
    servicePlan.max_mph_existing === DEFAULT_SERVICE.max_mph_existing &&
    servicePlan.max_mph_new === DEFAULT_SERVICE.max_mph_new;

  return (
    <div className="tab-body">
      <header className="tab-head">
        <div>
          <h2>Service and demand</h2>
          <p className="lede">
            A preliminary service model: how fast and how often trains could run on each alignment, how many people
            might ride, what it would cost to operate, and how the trip compares with driving and flying. Ridership is
            calibrated to Amtrak's FY2024 station ridership in this region, but the fit error is large, so every
            estimate is shown with its range. <StatusChip status="estimate" />
          </p>
        </div>
      </header>

      <section className="panel" aria-labelledby="plan-h">
        <h3 id="plan-h">
          Service plan <StatusChip status="assumption" />
        </h3>
        <div className="checks service-controls">
          <label className="field-inline">
            Daily round trips
            <input
              type="number"
              min={1}
              max={40}
              value={servicePlan.round_trips}
              onChange={(e) => {
                const v = Math.round(Number(e.target.value));
                if (v >= 1 && v <= 40) onServicePlan({ ...servicePlan, round_trips: v });
              }}
            />
          </label>
          <label className="field-inline">
            Top speed on existing rail
            <select
              value={servicePlan.max_mph_existing}
              onChange={(e) => onServicePlan({ ...servicePlan, max_mph_existing: Number(e.target.value) })}
            >
              {EXISTING_SPEEDS.map((v) => (
                <option key={v} value={v}>
                  {v} mph
                </option>
              ))}
            </select>
          </label>
          <label className="field-inline">
            Top speed on new track
            <select value={servicePlan.max_mph_new} onChange={(e) => onServicePlan({ ...servicePlan, max_mph_new: Number(e.target.value) })}>
              {NEW_SPEEDS.map((v) => (
                <option key={v} value={v}>
                  {v} mph
                </option>
              ))}
            </select>
          </label>
          <button onClick={() => onServicePlan({ ...DEFAULT_SERVICE })} disabled={isDefault}>
            Reset service plan
          </button>
        </div>
        <div role="status" aria-live="polite" className="live">
          {serviceLoading ? "Re-running the service model…" : ""}
        </div>
        {serviceError && (
          <p className="notice" role="alert">
            {serviceError} The estimates below are for the previous service plan.
          </p>
        )}
        <p className="fine">
          Every train stops at every station; service runs about 17 hours a day. Changing the plan re-runs ridership,
          finances, fleet and the benefit-cost ratio, and can change the ranking. Alignments and capital cost do not
          change: speeds above 90 mph on existing rail, and above 125 mph on new track, would need signal, track and
          (for high speed) electrification work that the capital cost does not include.
        </p>
      </section>

      <section className="panel">
        <h3>Compare the alternatives under this service plan</h3>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th scope="col">Alternative</th>
                <th scope="col" className="num">
                  Train time <MetricInfo m={METRIC.tripTime} />
                </th>
                <th scope="col" className="num">By car</th>
                <th scope="col" className="num">
                  Riders a year <MetricInfo m={METRIC.riders} />
                </th>
                <th scope="col" className="num">
                  Operating cost <MetricInfo m={METRIC.opex} />
                </th>
                <th scope="col" className="num">
                  Fare revenue <MetricInfo m={METRIC.revenue} />
                </th>
                <th scope="col" className="num">
                  Subsidy <MetricInfo m={METRIC.subsidy} />
                </th>
                <th scope="col" className="num">
                  Trainsets <MetricInfo m={METRIC.trainsets} />
                </th>
                <th scope="col" className="num">Seats filled</th>
              </tr>
            </thead>
            <tbody>
              {plan.routes.map((x, i) => {
                const s = x.service && x.service.available ? x.service : null;
                return (
                  <tr key={x.key} className={i === selected ? "sel" : ""}>
                    <th scope="row">
                      <button className="th-btn" onClick={() => onSelect(i)} aria-pressed={i === selected}>
                        <AltName r={x} i={i} />
                      </button>
                    </th>
                    {s ? (
                      <>
                        <td className="num">
                          {hm(s.end_to_end_min)}
                          <span className="muted block">{s.avg_speed_mph} mph average</span>
                        </td>
                        <td className="num">{hm(s.end_to_end_car_min)}</td>
                        <td className="num">{range(s.riders, people)}</td>
                        <td className="num">{range(s.opex, usd)}</td>
                        <td className="num">{range(s.revenue, usd)}</td>
                        <td className="num">{range(s.subsidy, money)}</td>
                        <td className="num">{s.trainsets}</td>
                        <td className="num">
                          {pct(s.load_factor * 100)}
                          {s.capacity_limited_share > 0.1 && <span className="warn-text block">Seats run short</span>}
                        </td>
                      </>
                    ) : (
                      <td colSpan={8} className="muted">
                        {x.service?.note || "Not available"}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="fine">
          Ranges are the middle 80% of 2,000 simulations of uncertain inputs (speeds, access time, fares, cost per
          train-mile, demand fit error). "Seats filled" is the average share of seats occupied; ridership is capped at
          75%, and "Seats run short" means demand exceeded that in more than 10% of simulations, so the plan needs more
          or longer trains. A negative subsidy is an operating surplus.
        </p>
      </section>

      {sv && (
        <section className="panel">
          <h3>
            Station pairs on <AltName r={r} i={selected} withLine />
          </h3>
          <p className="fine">
            {sv.round_trips} trains a day each way, about every {hm(sv.headway_min)}. Rail beats driving door to door
            for {pct(sv.share_pairs_faster_than_car * 100)} of station pairs. Door to door adds 50 minutes to reach and
            leave the stations and a quarter of the headway for waiting. Flying is compared only for pairs at least 300
            miles apart.
          </p>
          <div className="table-wrap">
            <table className="data pairs">
              <thead>
                <tr>
                  <th scope="col">Between</th>
                  <th scope="col" className="num">Rail miles</th>
                  <th scope="col" className="num">On the train</th>
                  <th scope="col" className="num">Rail door to door</th>
                  <th scope="col" className="num">Driving</th>
                  <th scope="col" className="num">Flying</th>
                  <th scope="col" className="num">Trips a year</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => {
                  const best = Math.min(p.car_min, p.air_min ?? Infinity);
                  return (
                    <tr key={p.a + p.b}>
                      <th scope="row">
                        {p.a} – {p.b}
                      </th>
                      <td className="num">{count(p.rail_miles)}</td>
                      <td className="num">{hm(p.train_min)}</td>
                      <td className="num">
                        {hm(p.rail_door_min)}
                        <span className={`block ${p.rail_door_min <= best ? "ok-text" : "muted"}`}>
                          {p.rail_door_min <= best ? "fastest" : `+${hm(p.rail_door_min - best)}`}
                        </span>
                      </td>
                      <td className="num">{hm(p.car_min)}</td>
                      <td className="num">{p.air_min == null ? "—" : hm(p.air_min)}</td>
                      <td className="num">{people(p.trips)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {pairs.length > 12 && (
            <button className="link" onClick={() => setShowAllPairs((x) => !x)}>
              {showAllPairs ? "Show the 12 busiest pairs" : `Show all ${pairs.length} pairs`}
            </button>
          )}
          <p className="fine">Trips are the central case, sorted from busiest. Most trips on a corridor are between intermediate cities, not end to end.</p>
        </section>
      )}

      <div className="two-col">
        <section className="panel">
          <h3>
            Who lives near the line <StatusChip status="screening" />
          </h3>
          <table className="data">
            <thead>
              <tr>
                <th scope="col">Alternative</th>
                <th scope="col" className="num">
                  Near stations <MetricInfo m={METRIC.popStations} />
                </th>
                <th scope="col" className="num">
                  Near the line <MetricInfo m={METRIC.popLine} />
                </th>
                <th scope="col" className="num">Stations</th>
              </tr>
            </thead>
            <tbody>
              {plan.routes.map((x, i) => (
                <tr key={x.key} className={i === selected ? "sel" : ""}>
                  <th scope="row">
                    <AltName r={x} i={i} />
                  </th>
                  <td className="num">{people(x.stats.pop_near_stations)}</td>
                  <td className="num">{people(x.stats.population_served)}</td>
                  <td className="num">{x.stats.stations.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="fine">
            Residents near stations feed the ridership model; they are not riders. A line can pass close to a large metro
            area without a station there.
          </p>
        </section>

        <section className="panel">
          <h3>How well the ridership model fits</h3>
          {calibration ? (
            <>
              <table className="data">
                <thead>
                  <tr>
                    <th scope="col">Station</th>
                    <th scope="col" className="num">FY2024 riders</th>
                    <th scope="col" className="num">Modeled</th>
                    <th scope="col" className="num">Ratio</th>
                  </tr>
                </thead>
                <tbody>
                  {calibration.stations.map((st) => (
                    <tr key={st.name}>
                      <th scope="row">{st.name}</th>
                      <td className="num">{count(st.observed)}</td>
                      <td className="num">{count(st.modeled)}</td>
                      <td className={`num ${st.ratio > 1.5 || st.ratio < 0.67 ? "warn-text" : ""}`}>{st.ratio.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="fine">
                Riders are Amtrak boardings plus alightings in FY2024 on existing services. Typical error is a factor of
                about {Math.exp(calibration.rms_log_error).toFixed(1)} in sample and{" "}
                {Math.exp(calibration.loo_rms_log_error).toFixed(1)} when a station is left out of the fit. {calibration.note}
              </p>
            </>
          ) : (
            <p className="fine">The calibration table could not be loaded.</p>
          )}
        </section>
      </div>

      <section className="panel callout-panel">
        <h3>Still not modeled</h3>
        <ul className="tight">
          {NOT_MODELED.filter((g) => ["Service", "Demand", "Infrastructure"].includes(g.group)).map((g) => (
            <li key={g.id}>
              <strong>{g.label}.</strong> {g.why} <span className="muted">Needs: {g.needs}</span>
            </li>
          ))}
        </ul>
        {sv && (
          <p className="fine">
            Screening indicator for {r.label}: {pct(sv.freight_share * 100)} of the route is on freight-owned track and{" "}
            {pct(sv.public_share * 100)} on Amtrak or commuter-agency track
            {sv.single_track_share != null ? `; ${pct(sv.single_track_share * 100)} of the existing rail used is single track where recorded` : ""}.
          </p>
        )}
      </section>
    </div>
  );
}
