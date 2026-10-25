import type { PlanResult, Range } from "../api";
import { money, usd } from "../format";
import { METRIC } from "../metrics";
import { AltName, MetricInfo, StatusChip } from "./ui";

interface Props {
  plan: PlanResult;
  selected: number;
}

const r2 = (x: Range | null | undefined) =>
  x ? (
    <>
      <span className="strong">{x.p50.toFixed(2)}</span>
      <span className="muted block">
        {x.p10.toFixed(2)} to {x.p90.toFixed(2)}
      </span>
    </>
  ) : (
    "—"
  );

const rm = (x: Range | null | undefined) =>
  x ? (
    <>
      <span className="strong">{money(x.p50)}</span>
      <span className="muted block">
        {money(x.p10)} to {money(x.p90)}
      </span>
    </>
  ) : (
    "—"
  );

// Preliminary benefit-cost analysis (USDOT 2026 values), with a 3.1% sensitivity.
export default function BenefitsPanel({ plan, selected }: Props) {
  return (
    <section className="panel" aria-labelledby="bca-h">
      <h3 id="bca-h">
        Benefits and costs over 30 years <StatusChip status="estimate" />
      </h3>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th scope="col">Alternative</th>
              <th scope="col" className="num">
                Benefit-cost ratio at 7% <MetricInfo m={METRIC.bcr} />
              </th>
              <th scope="col" className="num">At 3.1%</th>
              <th scope="col" className="num">Net present value at 7%</th>
              <th scope="col" className="num">Present value of costs</th>
              <th scope="col" className="num">Trainsets (purchase)</th>
              <th scope="col" className="num">User benefit a year</th>
              <th scope="col" className="num">Safety benefit a year</th>
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
                  {s ? (
                    <>
                      <td className="num">{r2(s.bcr)}</td>
                      <td className="num">{r2(s.bcr_alt)}</td>
                      <td className="num">{rm(s.npv)}</td>
                      <td className="num">{rm(s.pv_costs)}</td>
                      <td className="num">
                        {s.trainsets} sets
                        <span className="muted block">{s.fleet_cost ? usd(s.fleet_cost.p50) : ""}</span>
                      </td>
                      <td className="num">{rm(s.user_benefit)}</td>
                      <td className="num">{rm(s.safety_benefit)}</td>
                    </>
                  ) : (
                    <td colSpan={7} className="muted">
                      Not available
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="two-col">
        <div>
          <h4>Counted</h4>
          <ul className="tight fine">
            <li>Capital cost from the cost simulation, spent over the last 60% of the time to opening.</li>
            <li>Trainsets, bought before opening ($41M–$88M each, from Amtrak's 2021 Siemens order).</li>
            <li>Operating cost each year, and infrastructure renewals at 0.5–1.5% of capital a year.</li>
            <li>
              User benefit: half the saving in time and money, against driving, for trips where rail is cheaper door to
              door (USDOT values: $28.20 an hour, $0.56 per vehicle-mile).
            </li>
            <li>Fare revenue, which offsets the fare inside the user cost.</li>
            <li>Fatal crashes avoided on car miles shifted to rail ($15.4M each).</li>
          </ul>
        </div>
        <div>
          <h4>Not counted</h4>
          <ul className="tight fine">
            <li>Injury and property-damage crashes, air pollutants, noise and wider economic effects.</li>
            <li>Benefits to travelers who would otherwise fly or take the bus.</li>
            <li>Reliability, comfort and productivity on board, and residual value after 30 years.</li>
            <li>Carbon: USDOT's 2026 guidance no longer monetizes greenhouse gases (tonnes are reported on Impacts).</li>
          </ul>
        </div>
      </div>
      <p className="fine">
        Discounted at 7% a year as in USDOT's 2026 guidance; the 2024 guidance used 3.1%, shown for comparison. Because
        capital is spent years before benefits begin and several benefits are left out, these ratios are conservative.
        This is a screening estimate, not an official benefit-cost analysis.
      </p>
    </section>
  );
}
