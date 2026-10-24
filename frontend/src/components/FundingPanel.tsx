import { Fragment, useState } from "react";
import type { FundingMatch } from "../api";
import { usd } from "../format";

const KIND_LABEL: Record<FundingMatch["kind"], string> = { grant: "Grant", loan: "Loan", planning: "Planning" };

function federalCell(m: FundingMatch): string {
  if (!m.eligible) return "—";
  if (m.kind === "loan") return `${usd(m.cost_share.loan_usd)} loan`;
  return usd(m.cost_share.federal_usd);
}

function shareCell(m: FundingMatch): string {
  if (!m.eligible || m.kind !== "grant") return "—";
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
            <th>Program</th>
            <th className="hide-sm">Type</th>
            <th className="r">Fit</th>
            <th className="r">Federal</th>
            <th className="r hide-sm">Share of P50</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((m) => (
            <Fragment key={m.program_id}>
              <tr
                className={`frow ${m.eligible ? "" : "ineligible"} ${open === m.program_id ? "open" : ""}`}
                onClick={() => setOpen(open === m.program_id ? null : m.program_id)}
              >
                <td>
                  <span className="fname">{m.program_name}</span>
                  <span className="fagency">{m.agency}</span>
                </td>
                <td className="hide-sm">{KIND_LABEL[m.kind]}</td>
                <td className="r">
                  <span className="fit">
                    <span className="fit-track">
                      <span style={{ width: `${m.fit_score * 100}%` }} />
                    </span>
                    {m.fit_score.toFixed(2)}
                  </span>
                </td>
                <td className="r">{federalCell(m)}</td>
                <td className="r hide-sm">{shareCell(m)}</td>
              </tr>
              <tr className={`fwhy ${m.eligible ? "" : "ineligible"}`}>
                <td colSpan={5}>{m.rationale}</td>
              </tr>
            </Fragment>
          ))}
        </tbody>
      </table>
      <p className="note">
        Shares are computed at the median (P50) cost of {usd(basis)}; the remainder is the non-federal share.
        Program parameters are approximate and change each funding round.{" "}
        {eligible.length < matches.length && (
          <button className="link" onClick={() => setShowAll((s) => !s)}>
            {showAll ? "Hide ineligible programs." : `Show ${matches.length - eligible.length} ineligible.`}
          </button>
        )}
      </p>
    </div>
  );
}
