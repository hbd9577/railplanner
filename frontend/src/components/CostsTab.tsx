import { useState } from "react";
import type { PlanResult } from "../api";
import { altStyle, usd, years } from "../format";
import DistributionChart, { shareAbove } from "./DistributionChart";
import RangeCompare from "./RangeCompare";
import { AltName } from "./ui";

interface Props {
  plan: PlanResult;
  selected: number;
  onSelect: (i: number) => void;
}

function pctText(p: number): string {
  if (p < 0.005) return "under 1%";
  if (p > 0.995) return "over 99%";
  return `${Math.round(p * 100)}%`;
}

export default function CostsTab({ plan, selected, onSelect }: Props) {
  const r = plan.routes[selected];
  const runs = r.simulation.runs;
  const [budget, setBudget] = useState(() => Math.round(r.simulation.cost.p50 / 1e9));
  const [openBy, setOpenBy] = useState(() => Math.round(r.simulation.duration.p50 / 12));

  return (
    <div className="tab-body">
      <header className="tab-head">
        <div>
          <h2>Costs and schedule</h2>
          <p className="lede">
            Each alternative was simulated {runs.toLocaleString()} times. <strong>P50</strong> is the median: half the
            modeled outcomes are higher. <strong>P10 to P90</strong> is the middle 80% of modeled outcomes. These ranges
            describe uncertainty inside the model; they are not guarantees, and they cannot account for errors in the
            model itself.
          </p>
        </div>
      </header>

      <div className="two-col">
        <RangeCompare title="Capital cost" routes={plan.routes} pick={(x) => x.simulation.cost} format={usd} selected={selected} onSelect={onSelect} />
        <RangeCompare title="Time to opening" routes={plan.routes} pick={(x) => x.simulation.duration} format={years} selected={selected} onSelect={onSelect} />
      </div>

      <section className="panel">
        <h3>
          Distribution for <AltName r={r} i={selected} withLine />
        </h3>
        <div className="two-col">
          <DistributionChart title="Capital cost, all runs" dist={r.simulation.cost} color={altStyle(selected).color} format={usd} runs={runs} threshold={budget * 1e9} thresholdLabel="Budget" />
          <DistributionChart title="Time to opening, all runs" dist={r.simulation.duration} color={altStyle(selected).color} format={years} runs={runs} threshold={openBy * 12} thresholdLabel="Target" />
        </div>
      </section>

      <section className="panel">
        <h3>Check a budget or an opening target</h3>
        <div className="checks">
          <label className="field-inline">
            Budget (US$ billions)
            <input type="number" min={0} step={0.5} value={budget} onChange={(e) => setBudget(Number(e.target.value))} />
          </label>
          <label className="field-inline">
            Open within (years)
            <input type="number" min={1} step={1} value={openBy} onChange={(e) => setOpenBy(Number(e.target.value))} />
          </label>
        </div>
        <table className="data">
          <thead>
            <tr>
              <th scope="col">Alternative</th>
              <th scope="col" className="num">Modeled runs over budget</th>
              <th scope="col" className="num">Modeled runs opening later</th>
            </tr>
          </thead>
          <tbody>
            {plan.routes.map((x, i) => (
              <tr key={x.key} className={i === selected ? "sel" : ""}>
                <th scope="row">
                  <AltName r={x} i={i} />
                </th>
                <td className="num">{pctText(shareAbove(x.simulation.cost, budget * 1e9))}</td>
                <td className="num">{pctText(shareAbove(x.simulation.duration, openBy * 12))}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="fine">
          Shares of simulated runs, read from the stored histograms. They inherit every assumption of the model and are
          not probabilities that the real project will exceed these values.
        </p>
      </section>

      <div className="two-col">
        <section className="panel">
          <h3>What the cost includes</h3>
          <ul className="tight">
            <li>Track work per mile by terrain (flat, rolling, mountainous), density (rural, suburban, urban) and treatment (new, upgrade of active rail, reactivation of inactive rail).</li>
            <li>Land for new right-of-way, earthwork, track and systems are inside the per-mile benchmarks.</li>
            <li>Tunnels and long viaducts on a share of new mountainous miles.</li>
            <li>Grade separations at an assumed rate per mile; on existing rail only a share is separated.</li>
            <li>Major river bridges (new, or rehabilitation on existing corridors) and stations.</li>
            <li>A shared market factor and 15–30% contingency.</li>
          </ul>
          <h4>Not included</h4>
          <ul className="tight">
            <li>Rolling stock, maintenance facilities and electrification.</li>
            <li>Access payments or capacity work required by host railroads.</li>
            <li>Operating and maintenance costs and future renewals.</li>
            <li>Financing costs.</li>
          </ul>
          <p className="fine">
            Currency: US dollars. Cost year: not specified, because the per-mile benchmarks are illustrative
            placeholders. No inflation or escalation is applied. The largest drivers of the range are the per-mile
            benchmark, the upgrade factor, grade separations and contingency.
          </p>
        </section>
        <section className="panel">
          <h3>What the schedule includes</h3>
          <ul className="tight">
            <li><strong>Clock starts</strong> at the beginning of planning and environmental review.</li>
            <li>Planning and environmental review: longer with more flagged-area entries, shorter on existing corridors, plus land acquisition time in proportion to new track.</li>
            <li>Design, scaled with project size.</li>
            <li>Procurement, overlapping the last quarter of design.</li>
            <li>Construction, scaled with length and simulated cost; long corridors are built as segments of about 300 miles with staggered starts.</li>
          </ul>
          <h4>Not included</h4>
          <ul className="tight">
            <li>Testing, commissioning and pre-revenue operations as separate stages.</li>
            <li>Funding gaps, litigation, and host-railroad negotiations.</li>
          </ul>
          <p className="fine">
            Construction time is tied to each run's simulated cost, so cost and schedule move together. Other inputs
            are drawn independently, which may understate how often several things go wrong at once.
          </p>
        </section>
      </div>

      <section className="panel subtle">
        <h3>Uncertainty within the model, and about the model</h3>
        <p>
          The {runs.toLocaleString()} simulations show how results vary when the model's inputs vary within the ranges
          we assumed. They do not test whether those ranges are right, and more simulations would not fix missing
          data. The benchmarks are uncalibrated, travel demand and operations are not modeled, and alignments are
          conceptual. Treat the ranges as a comparison between alternatives, not a forecast.
        </p>
      </section>
    </div>
  );
}
