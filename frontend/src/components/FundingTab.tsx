import { Fragment, useState } from "react";
import type { FundingMatch, PlanResult } from "../api";
import { usd } from "../format";
import { AltName, StatusChip } from "./ui";

interface Props {
  plan: PlanResult;
  selected: number;
  onSelect: (i: number) => void;
}

const KIND_LABEL: Record<FundingMatch["kind"], string> = { grant: "Grant", loan: "Loan", planning: "Planning" };

function federalCell(m: FundingMatch): string {
  if (!m.eligible) return "—";
  if (m.kind === "loan") return `up to ${usd(m.cost_share.loan_usd)} loan`;
  return usd(m.cost_share.federal_usd);
}

export default function FundingTab({ plan, selected, onSelect }: Props) {
  const r = plan.routes[selected];
  const [showAll, setShowAll] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const eligible = r.funding.filter((m) => m.eligible);
  const shown = showAll ? r.funding : eligible;
  const basis = r.simulation.cost.p50;

  return (
    <div className="tab-body">
      <header className="tab-head">
        <div>
          <h2>Funding fit</h2>
          <p className="lede">
            Which federal programs this kind of project could plausibly apply to, using simple rules on project type,
            size and location. <strong>This is a screening aid, not an eligibility determination</strong>: program
            rules, award sizes and match requirements change each funding round, and awards are competitive.
          </p>
        </div>
        <label className="field-inline">
          Alternative
          <select value={selected} onChange={(e) => onSelect(Number(e.target.value))}>
            {plan.routes.map((x, i) => (
              <option key={x.key} value={i}>
                {x.rank}. {x.label}
              </option>
            ))}
          </select>
        </label>
      </header>

      <section className="panel">
        <h3>
          Programs for <AltName r={r} i={selected} withLine /> <StatusChip status="rule-based" />
        </h3>
        <table className="data">
          <thead>
            <tr>
              <th scope="col">Program</th>
              <th scope="col">Type</th>
              <th scope="col" className="num">Fit (0–1)</th>
              <th scope="col" className="num">Federal share at median cost</th>
              <th scope="col" className="num">Federal %</th>
              <th scope="col">
                <span className="sr-only">Details</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((m) => (
              <Fragment key={m.program_id}>
                <tr className={m.eligible ? "" : "muted-row"}>
                  <th scope="row">
                    <span className="fname">{m.program_name}</span>
                    <span className="fagency">{m.agency}</span>
                  </th>
                  <td>{KIND_LABEL[m.kind]}</td>
                  <td className="num">{m.eligible ? m.fit_score.toFixed(2) : "Not a fit"}</td>
                  <td className="num">{federalCell(m)}</td>
                  <td className="num">{m.eligible && m.kind === "grant" ? `${m.cost_share.federal_pct.toFixed(0)}%` : "—"}</td>
                  <td>
                    <button
                      className="link"
                      aria-expanded={open === m.program_id}
                      onClick={() => setOpen(open === m.program_id ? null : m.program_id)}
                    >
                      {open === m.program_id ? "Hide why" : "Why"}
                    </button>
                  </td>
                </tr>
                {open === m.program_id && (
                  <tr className="detail-row">
                    <td colSpan={6}>{m.rationale}</td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
        {eligible.length < r.funding.length && (
          <button className="link" onClick={() => setShowAll((s) => !s)}>
            {showAll ? "Hide programs that do not fit" : `Show ${r.funding.length - eligible.length} programs that do not fit`}
          </button>
        )}
        <p className="fine">
          Each row is computed on its own at the median capital cost of {usd(basis)}: the program's maximum federal
          match, capped at its largest typical award. Rows are alternatives, not amounts to add together. Awards are
          competitive and usually spread across several rounds; the remainder must come from state, local or private
          sponsors. These capital programs do not cover operating support.
        </p>
      </section>
    </div>
  );
}
