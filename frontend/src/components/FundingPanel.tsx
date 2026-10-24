import { useState } from "react";
import type { FundingMatch } from "../api";
import { usd } from "../format";

const KIND_LABEL: Record<FundingMatch["kind"], string> = { grant: "Grant", loan: "Loan", planning: "Planning" };

function Match({ m }: { m: FundingMatch }) {
  const cs = m.cost_share;
  const fedPct = Math.max(0, Math.min(100, cs.federal_pct));
  return (
    <li className={`fund ${m.eligible ? "" : "ineligible"}`}>
      <div className="fund-head">
        <div>
          <div className="fund-name">{m.program_name}</div>
          <div className="muted small">
            {m.agency} &middot; <span className="kind">{KIND_LABEL[m.kind]}</span>
            {!m.eligible && <> &middot; not eligible</>}
          </div>
        </div>
        <div className="fit" title="Fit score (0-1)">
          <span className="fit-bar">
            <span style={{ width: `${m.fit_score * 100}%` }} />
          </span>
          <span className="fit-num">{m.fit_score.toFixed(2)}</span>
        </div>
      </div>
      <p className="fund-why">{m.rationale}</p>
      {m.eligible && (
        <div className="split">
          {m.kind === "loan" ? (
            <span className="small">
              Loan up to <strong>{usd(cs.loan_usd)}</strong> toward the non-federal share
            </span>
          ) : m.kind === "planning" ? (
            <span className="small">
              Federal planning grant of about <strong>{usd(cs.federal_usd)}</strong>; no capital cost share
            </span>
          ) : (
            <>
              <span className="split-bar" aria-hidden>
                <span className="fed" style={{ width: `${Math.max(fedPct, 0.6)}%` }} />
              </span>
              <span className="small">
                Federal <strong>{usd(cs.federal_usd)}</strong> ({cs.federal_pct.toFixed(1)}%) &middot; Non-federal{" "}
                <strong>{usd(cs.non_federal_usd)}</strong> at P50 {usd(cs.basis_cost_usd)}
              </span>
            </>
          )}
        </div>
      )}
    </li>
  );
}

export default function FundingPanel({ matches }: { matches: FundingMatch[] }) {
  const [showAll, setShowAll] = useState(false);
  const eligible = matches.filter((m) => m.eligible);
  const shown = showAll ? matches : eligible;
  return (
    <div>
      <ul className="funding">
        {shown.map((m) => (
          <Match key={m.program_id} m={m} />
        ))}
      </ul>
      {eligible.length < matches.length && (
        <button className="link" onClick={() => setShowAll((s) => !s)}>
          {showAll ? "Hide ineligible programs" : `Show ${matches.length - eligible.length} ineligible program(s)`}
        </button>
      )}
    </div>
  );
}
