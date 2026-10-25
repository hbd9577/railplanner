import { useEffect, useState } from "react";
import { api, type City, type FundingMatch, type FundingProgram, type PlanResult } from "../api";
import { usd } from "../format";
import { AltName, StatusChip } from "./ui";

interface Props {
  plan: PlanResult;
  cities: City[];
  selected: number;
  onSelect: (i: number) => void;
}

const KIND_LABEL: Record<FundingMatch["kind"], string> = { grant: "Grant", loan: "Loan (must be repaid)", planning: "Planning grant" };

/** Amounts RailPlanner assumes for screening (not set by the user and not a program limit). */
function ModelAssumption() {
  return (
    <span className="chip chip-assumption" title="A screening assumption built into RailPlanner, not a program limit or award estimate.">
      RailPlanner assumption
    </span>
  );
}

function fitWord(m: FundingMatch): string {
  if (!m.eligible) return "Not a fit";
  if (m.fit_score >= 0.8) return "Strong fit";
  if (m.fit_score >= 0.5) return "Moderate fit";
  return "Limited fit";
}

// Programs are compared one at a time: RailPlanner has no stacking rules, so amounts are never summed.
export default function FundingTab({ plan, cities, selected, onSelect }: Props) {
  const r = plan.routes[selected];
  const [programs, setPrograms] = useState<Record<string, FundingProgram> | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [showAll, setShowAll] = useState(false);

  function load() {
    setLoadError(false);
    api
      .fundingPrograms()
      .then((ps) => setPrograms(Object.fromEntries(ps.map((p) => [p.id, p]))))
      .catch(() => setLoadError(true));
  }
  useEffect(load, []);

  const basis = r.simulation.cost.p50;
  const fits = r.funding.filter((m) => m.eligible);
  const shown = showAll ? r.funding : fits;
  const grants = fits.filter((m) => m.kind === "grant" && m.cost_share.federal_usd > 0);
  const biggest = grants.reduce<FundingMatch | null>((a, m) => (!a || m.cost_share.federal_usd > a.cost_share.federal_usd ? m : a), null);
  const loan = fits.find((m) => m.kind === "loan");
  const stateOf = new Map(cities.map((c) => [c.name, c.state]));
  const states = Array.from(new Set(r.stats.stations.map((s) => stateOf.get(s)).filter(Boolean))) as string[];

  return (
    <div className="tab-body">
      <header className="tab-head">
        <div>
          <h2>Funding guide</h2>
          <p className="lede">
            Federal programs this kind of project could pursue, with what each requires and where things stand.
            Program facts are checked against official sources (dates below). Fit is a qualitative screening judgment,
            not an eligibility determination or a probability of award.
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

      <div className="two-col">
        <section className="panel">
          <h3>
            Funding position for <AltName r={r} i={selected} withLine />
          </h3>
          <dl className="position">
            <div>
              <dt>Median capital cost</dt>
              <dd>
                {usd(basis)} <StatusChip status="estimate" />
              </dd>
            </div>
            <div>
              <dt>Secured or committed funding</dt>
              <dd>None recorded. RailPlanner has no information on committed funds.</dd>
            </div>
            {biggest && (
              <div>
                <dt>Largest single grant, if awarded in full</dt>
                <dd>
                  {usd(biggest.cost_share.federal_usd)} from {biggest.program_name.replace(/ \(.*\)$/, "")}{" "}
                  <ModelAssumption />
                  <span className="fine block">
                    That would leave {usd(basis - biggest.cost_share.federal_usd)} ({(100 - biggest.cost_share.federal_pct).toFixed(0)}% of the
                    median cost) to other sources. Real awards are competitive and usually smaller.
                  </span>
                </dd>
              </div>
            )}
            {loan && (
              <div>
                <dt>Loan financing</dt>
                <dd>
                  RRIF could finance part of the remaining need, for example {usd(loan.cost_share.loan_usd)} (illustrative), but it
                  must be repaid from a dedicated revenue source. A loan finances the gap; it does not close it.
                </dd>
              </div>
            )}
          </dl>
          <p className="fine">
            Program amounts are shown one at a time and never added together: whether awards can be combined depends on
            each program's rules and on separate applications, which are not modeled.
          </p>
        </section>

        <section className="panel">
          <h3>Sponsor requirements</h3>
          <ul className="tight">
            {states.length > 1 ? (
              <li>
                The route crosses {states.length} states ({states.join(", ")}). Federal applications need an eligible
                sponsor for the whole corridor: a group of States, an interstate compact or authority, or Amtrak working
                with the States.
              </li>
            ) : (
              <li>The route lies within one state; the state DOT or a public rail authority would normally sponsor it.</li>
            )}
            <li>Capital grants here need a non-federal share: FRA capital programs cap the federal share at 80%.</li>
            <li>
              {r.stats.row_reuse_pct >= 50
                ? "Using existing rail corridors requires agreements with the host railroads on access, capacity and cost sharing before capital applications are credible."
                : "New right-of-way needs land acquisition and full environmental review before construction funding."}
            </li>
            <li>Operating support after opening is a state or sponsor responsibility; these capital programs do not fund it.</li>
          </ul>
        </section>
      </div>

      {loadError && (
        <div className="notice" role="alert">
          Could not load program details (applicants, deadlines, sources). The screening results below are still valid.{" "}
          <button className="link" onClick={load}>
            Try again
          </button>
        </div>
      )}

      <section aria-label="Programs" className="program-list">
        {shown.map((m) => {
          const g = programs?.[m.program_id]?.guide;
          return (
            <article key={m.program_id} className={`program${m.eligible ? "" : " no-fit"}`}>
              <header>
                <div>
                  <h3>{m.program_name}</h3>
                  <span className="fagency">
                    {m.agency} · {KIND_LABEL[m.kind]}
                  </span>
                </div>
                <span className={`fit-tag fit-${fitWord(m).split(" ")[0].toLowerCase()}`}>
                  {fitWord(m)}
                  {m.eligible && <span className="num-cell"> ({m.fit_score.toFixed(2)})</span>}
                </span>
              </header>
              <p>
                <strong>Screening: </strong>
                {m.eligible ? "passes the basic project-type screen. " : "does not pass the basic screen. "}
                {m.rationale}
              </p>
              {g && (
                <dl className="prov">
                  <div>
                    <dt>Eligible applicants</dt>
                    <dd>{g.applicants}</dd>
                  </div>
                  <div>
                    <dt>Project stage</dt>
                    <dd>{g.stage}</dd>
                  </div>
                  <div>
                    <dt>Match</dt>
                    <dd>{g.match}</dd>
                  </div>
                  <div>
                    <dt>Limits and assumptions</dt>
                    <dd>{g.limits}</dd>
                  </div>
                  {m.eligible && m.kind !== "loan" && (
                    <div>
                      <dt>Assumed federal amount</dt>
                      <dd>
                        {usd(m.cost_share.federal_usd)}
                        {m.kind === "grant" && ` (${m.cost_share.federal_pct.toFixed(0)}% of the median cost)`}{" "}
                        {m.kind === "grant" && <ModelAssumption />}
                      </dd>
                    </div>
                  )}
                  <div>
                    <dt>Status</dt>
                    <dd>{g.status}</dd>
                  </div>
                  <div>
                    <dt>How fit is scored</dt>
                    <dd>{g.fit_rule}</dd>
                  </div>
                  <div>
                    <dt>Next step</dt>
                    <dd className="strong">{g.next_step}</dd>
                  </div>
                  <div>
                    <dt>Source</dt>
                    <dd>
                      <a href={g.source_url} target="_blank" rel="noreferrer">
                        {g.source_label}
                      </a>
                      <span className={`verify verify-${g.verification}`}>
                        {g.verification === "verified" ? "Verified" : g.verification === "partial" ? "Partly verified" : "Not verified"}{" "}
                        {g.verified_on}
                      </span>
                      {g.unverified_fields.length > 0 && (
                        <span className="fine block">Not verified: {g.unverified_fields.join("; ")}.</span>
                      )}
                    </dd>
                  </div>
                </dl>
              )}
              {!g && !loadError && <p className="fine">Loading program details…</p>}
            </article>
          );
        })}
      </section>
      {fits.length < r.funding.length && (
        <button className="link" onClick={() => setShowAll((s) => !s)}>
          {showAll ? "Hide programs that do not fit" : `Show ${r.funding.length - fits.length} programs that do not fit`}
        </button>
      )}
      <p className="fine">
        Fit scores are fixed rules on project type, size and location (shown on each card). They are not validated
        against award outcomes and do not estimate the chance of funding.
      </p>
    </div>
  );
}
