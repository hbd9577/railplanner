import { useEffect, useState } from "react";
import { api, type ServiceParameter, type ServiceParametersResponse } from "../api";
import { StatusChip } from "./ui";

const LABELS: Record<string, string> = {
  round_trips: "Daily round trips",
  span_hours: "Hours of service a day",
  max_mph_existing: "Top speed, existing rail",
  max_mph_new: "Top speed, new track",
  max_mph_mountain: "Top speed, mountainous sections",
  speed_efficiency: "Average speed as a share of top speed",
  stop_penalty_min: "Time lost per stop",
  terminal_penalty_min: "Time lost per large-terminal approach",
  access_egress_min: "Time to reach and leave stations",
  car_circuity: "Road miles per straight-line mile",
  car_mph: "Average driving speed",
  car_fixed_min: "Parking and local streets",
  air_fixed_min: "Airport time",
  air_block_mph: "Flying speed, gate to gate",
  pop_exponent: "Population exponent",
  freq_elasticity: "Frequency elasticity",
  time_ratio_exponent: "Rail-to-competitor time sensitivity",
  demand_scale: "Demand scale",
  fare_per_pmi: "Fare revenue per passenger-mile",
  cost_per_train_mile: "Operating cost per train-mile",
  seats_per_train: "Seats per train",
  max_load_factor: "Maximum average load",
  trainset_cost: "Cost per trainset",
  spare_ratio: "Spare trainsets",
  turnaround_min: "Turnaround at each end",
  renewal_share: "Infrastructure renewals",
  ramp_up: "Ridership ramp-up",
  vtts_intercity_personal: "Value of time, intercity personal travel",
  voc_per_mile: "Vehicle operating cost",
  car_occupancy: "People per car",
  fatal_crash_value: "Value of a fatal crash avoided",
  discount_rate: "Discount rate",
  discount_rate_alt: "Discount rate, sensitivity",
  analysis_years: "Years of operation analyzed",
  fatality_rate: "Road deaths per vehicle-mile",
  car_co2_g_per_mile: "Car CO2 per mile",
  diesel_co2_g_per_gal: "Diesel CO2 per gallon",
  rail_btu_per_car_mile: "Rail energy per railcar-mile",
  cars_per_train: "Railcars per train",
  diesel_btu_per_gal: "Diesel energy per gallon",
  car_diversion_share: "Riders who would otherwise drive",
};

const BASIS = { verified: "observed", derived: "observed", assumption: "assumption" } as const;
const BASIS_LABEL = { verified: "Verified source", derived: "Derived from sources", assumption: "RailPlanner assumption" };

function value(p: ServiceParameter): string {
  const v = p.value;
  if (v == null) return "Fitted";
  if (Array.isArray(v)) return v.join(", ");
  const f = (x: number) => (Math.abs(x) >= 1e5 ? x.toLocaleString() : String(x));
  return p.low != null && p.high != null ? `${f(v)} (${f(p.low)}–${f(p.high)})` : f(v);
}

// Every input to the service model, with its basis and source; plus the demand calibration.
export default function ServiceParametersPanel() {
  const [data, setData] = useState<ServiceParametersResponse | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    api
      .serviceParameters()
      .then(setData)
      .catch(() => setError(true));
  }, []);

  if (error) return <p className="notice">Could not load the service model inputs.</p>;
  if (!data) return <p className="fine">Loading the service model inputs…</p>;
  const cal = data.calibration;
  return (
    <section className="panel" aria-labelledby="svcp-h">
      <h3 id="svcp-h">Service model inputs</h3>
      <p className="fine">
        Checked {data.parameters.checked_on}. Values in brackets are the range sampled in the simulation. Fitted demand
        parameters: time sensitivity {cal.time_ratio_exponent}, distance decay {cal.distance_decay}, fitted to{" "}
        {cal.stations.length} stations and {cal.pairs_used} station pairs with FY2024 service.
      </p>
      <div className="table-wrap">
        <table className="data registry">
          <thead>
            <tr>
              <th scope="col">Input</th>
              <th scope="col">Value</th>
              <th scope="col">Basis</th>
              <th scope="col">Source or note</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(data.parameters.params).map(([k, p]) => (
              <tr key={k}>
                <th scope="row">{LABELS[k] ?? k}</th>
                <td>
                  {value(p)} <span className="muted">{p.unit}</span>
                </td>
                <td>
                  <span className={`chip chip-${BASIS[p.basis]}`}>{BASIS_LABEL[p.basis]}</span>
                </td>
                <td>
                  {p.source ?? p.note ?? ""}{" "}
                  {p.url && (
                    <a href={p.url} target="_blank" rel="noreferrer">
                      source
                    </a>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="fine">
        Ridership calibration: {data.observed.sources.map((s, i) => (
          <span key={s.url}>
            {i > 0 && "; "}
            <a href={s.url} target="_blank" rel="noreferrer">
              {s.label}
            </a>
          </span>
        ))}
        . <StatusChip status="estimate" />
      </p>
    </section>
  );
}
