import { useState } from "react";
import type { FundingMatch } from "../api";
import { usd } from "../format";

const KIND_LABEL: Record<FundingMatch["kind"], string> = { grant: "Grant", loan: "Loan", planning: "Planning" };

function fitLabel(fit: number): string {
  if (fit >= 0.8) return "Strong fit";
  if (fit >= 0.5) return "Moderate fit";
  if (fit > 0) return "Weak fit";
  return "Not eligible";
}

function Figures({ m }: { m: FundingMatch }) {
  const cs = m.cost_share;
  if (m.kind === "loan") {
    return (
      <div className="figs">
        <div className="fig">
          <span className="fig-lbl">Loan capacity</span>
          <span className="fig-val">{usd(cs.loan_usd)}</span>
        </div>
        <div className="fig">
          <span className="fig-lbl">Applies to</span>
          <span className="fig-val sm">Non-federal share</span>
        </div>
      </div>
    );
  }
  if (m.kind === "planning") {
    return (
      <div className="figs">
        <div className="fig">
          <span className="fig-lbl">Planning grant</span>
          <span className="fig-val">≈ {usd(cs.federal_usd)}</span>
        </div>
        <div className="fig">
          <span className="fig-lbl">Capital share</span>
          <span className="fig-val sm">None (planning only)</span>
        </div>
      </div>
    );
  }
  return (
    <>
      <div className="figs">
        <div className="fig">
          <span className="fig-lbl">Federal</span>
          <span className="fig-val">{usd(cs.federal_usd)}</span>
        </div>
        <div className="fig">
          <span className="fig-lbl">Non-federal</span>
          <span className="fig-val">{usd(cs.non_federal_usd)}</span>
        </div>
        <div className="fig">
          <span className="fig-lbl">Federal share</span>
          <span className="fig-val">{cs.federal_pct.toFixed(1)}%</span>
        </div>
      </div>
      <span className="split-bar" aria-hidden>
        <span className="fed" style={{ width: `${Math.max(Math.min(cs.federal_pct, 100), 0.8)}%` }} />
      </span>
    </>
  );
}

function Match({ m }: { m: FundingMatch }) {
  return (
    <li className={`fund ${m.eligible ? "" : "ineligible"}`}>
      <div className="fund-head">
        <div className="fund-id">
          <div className="fund-name">{m.program_name}</div>
          <div className="fund-meta">
            <span className="badge">{KIND_LABEL[m.kind]}</span>
            <span>{m.agency}</span>
          </div>
        </div>
        <div className="fit" title={`Fit score ${m.fit_score.toFixed(2)} of 1`}>
          <span className="fit-num">{m.fit_score.toFixed(2)}</span>
          <span className="fit-lbl">{fitLabel(m.fit_score)}</span>
          <span className="fit-bar">
            <span style={{ width: `${m.fit_score * 100}%` }} />
          </span>
        </div>
      </div>
      <p className="fund-why">{m.rationale}</p>
      {m.eligible && <Figures m={m} />}
    </li>
  );
}

export default function FundingPanel({ matches, basis }: { matches: FundingMatch[]; basis: number }) {
  const [showAll, setShowAll] = useState(false);
  const eligible = matches.filter((m) => m.eligible);
  const shown = showAll ? matches : eligible;
  return (
    <div>
      <p className="muted small">
        Cost shares at the P50 cost of <strong>{usd(basis)}</strong>. Program parameters are approximate.
      </p>
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
