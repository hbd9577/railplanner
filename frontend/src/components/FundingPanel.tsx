import { Fragment, useState } from "react";
import type { FundingMatch } from "../api";
import { usd } from "../format";

const KIND_LABEL: Record<FundingMatch["kind"], string> = { grant: "Grant", loan: "Loan", planning: "Planning" };

function federalCell(m: FundingMatch): string {
  if (!m.eligible) return "Not eligible";
  if (m.kind === "loan") return `${usd(m.cost_share.loan_usd)} loan`;
  return usd(m.cost_share.federal_usd);
}

function shareCell(m: FundingMatch): string {
  if (!m.eligible || m.kind !== "grant") return "n/a";
  return `${m.cost_share.federal_pct.toFixed(1)}%`;
}

export default function FundingPanel({ matches, basis }: { matches: FundingMatch[]; basis: number }) {
  const [showAll, setShowAll] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const eligible = matches.filter((m) => m.eligible);
  const shown = showAll ? matches : eligible;
  return (
    <div>
      <table className="ftable">
        <thead>
          <tr>
            <th scope="col">Program</th>
            <th scope="col" className="hide-sm">
              Type
            </th>
            <th scope="col" className="r">
              Fit
            </th>
            <th scope="col" className="r">
              Federal
            </th>
            <th scope="col" className="r hide-sm">
              Share of P50
            </th>
          </tr>
        </thead>
        <tbody>
          {shown.map((m) => {
            const isOpen = open === m.program_id;
            const whyId = `why-${m.program_id}`;
            return (
              <Fragment key={m.program_id}>
                <tr className={m.eligible ? "" : "ineligible"}>
                  <td>
                    <button
                      className="prog"
                      aria-expanded={isOpen}
                      aria-controls={whyId}
                      onClick={() => setOpen(isOpen ? null : m.program_id)}
                    >
                      <span className="prog-name">{m.program_name}</span>
                      <span className="prog-agency">{m.agency}</span>
                    </button>
                  </td>
                  <td className="hide-sm">{KIND_LABEL[m.kind]}</td>
                  <td className="r">
                    <span className="fit">
                      <span className="fit-track" aria-hidden="true">
                        <span style={{ width: `${m.fit_score * 100}%` }} />
                      </span>
                      {m.fit_score.toFixed(2)}
                    </span>
                  </td>
                  <td className="r">{federalCell(m)}</td>
                  <td className="r hide-sm">{shareCell(m)}</td>
                </tr>
                {isOpen && (
                  <tr className="why" id={whyId}>
                    <td colSpan={5}>
                      <p>{m.rationale}</p>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      <p className="caption">
        Federal amounts are at the median cost of {usd(basis)}; the remainder is the non-federal share. Program
        parameters are approximate and change each funding round.
      </p>
      {eligible.length < matches.length && (
        <button className="btn-text" onClick={() => setShowAll((s) => !s)}>
          {showAll ? "Hide ineligible programs" : `Show ${matches.length - eligible.length} ineligible program(s)`}
        </button>
      )}
    </div>
  );
}
