import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { ApiError, api, type NumberCheck, type ProposalResult, type ScenarioPayload } from "../api";
import { download, printHtml } from "../scenario";

interface Props {
  requestId: number | null;
  scenario: ScenarioPayload;
  suggestions: string[];
  fileStem: string;
}

type Status = { kind: "idle" } | { kind: "loading" } | { kind: "error"; message: string };

interface Answer {
  q: string;
  a: string;
  check?: NumberCheck;
  detail: boolean;
}

function errorText(e: unknown, fallback: string): string {
  if (e instanceof ApiError && e.status === 503) return e.message;
  return e instanceof Error ? `${fallback}: ${e.message}` : fallback;
}

const scenarioKey = (s: ScenarioPayload) => JSON.stringify([s.priorities, s.ranking]);

export default function ProposalPanel({ requestId, scenario, suggestions, fileStem }: Props) {
  const [proposal, setProposal] = useState<ProposalResult | null>(null);
  const [draftKey, setDraftKey] = useState<string | null>(null);
  const [edited, setEdited] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [question, setQuestion] = useState("");
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [askState, setAskState] = useState<Status>({ kind: "idle" });
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setProposal(null);
    setEdited(null);
    setEditing(false);
    setStatus({ kind: "idle" });
    setAnswers([]);
  }, [requestId]);

  if (requestId == null) {
    return <p className="muted">Proposals need a stored plan. Reconnect the database and compare routes again.</p>;
  }

  const stale = proposal != null && draftKey !== scenarioKey(scenario);
  const text = edited ?? proposal?.markdown ?? "";

  async function generate(refresh: boolean) {
    setStatus({ kind: "loading" });
    try {
      setProposal(await api.proposal(requestId!, refresh, scenario));
      setDraftKey(scenarioKey(scenario));
      setEdited(null);
      setEditing(false);
      setStatus({ kind: "idle" });
    } catch (e) {
      setStatus({ kind: "error", message: errorText(e, "Could not generate the proposal") });
    }
  }

  async function ask(q: string, detail = false) {
    q = q.trim();
    if (!q) return;
    setAskState({ kind: "loading" });
    try {
      const { answer, number_check } = await api.ask(requestId!, q, scenario, detail);
      setAnswers((xs) => [...xs.filter((x) => !(x.q === q && detail)), { q, a: answer, check: number_check, detail }]);
      setQuestion("");
      setAskState({ kind: "idle" });
    } catch (err) {
      setAskState({ kind: "error", message: errorText(err, "Could not answer") });
    }
  }

  function exportMd() {
    download(`${fileStem}-proposal.md`, text, "text/markdown");
    setNotice("Proposal downloaded as Markdown.");
  }

  function exportPdf() {
    const article = document.querySelector(".proposal .markdown");
    const ok = article && printHtml(`Proposal: ${fileStem}`, article.innerHTML);
    setNotice(ok ? "Print dialog opened: choose “Save as PDF”." : "Could not open the print window. Allow pop-ups and try again.");
  }

  return (
    <div className="proposal">
      <div className="proposal-actions">
        <button className="primary" onClick={() => generate(!!proposal)} disabled={status.kind === "loading"}>
          {status.kind === "loading" ? (
            <>
              <span className="spinner" aria-hidden="true" /> Drafting proposal…
            </>
          ) : proposal ? (
            "Regenerate for this scenario"
          ) : (
            "Generate proposal"
          )}
        </button>
        {proposal && (
          <>
            <button onClick={() => setEditing((e) => !e)} aria-pressed={editing}>
              {editing ? "Done editing" : "Review and edit"}
            </button>
            <button onClick={exportMd}>Download Markdown</button>
            <button onClick={exportPdf} disabled={editing}>
              Print or save as PDF
            </button>
          </>
        )}
      </div>
      <div role="status" aria-live="polite" className="live">
        {status.kind === "loading" && "Drafting from the computed results; this usually takes 10 to 30 seconds."}
        {notice}
      </div>
      {proposal?.number_check && (
        <p className={`check ${proposal.number_check.passed ? "ok" : "warn"}`}>
          {proposal.number_check.passed
            ? "Number check passed: every figure in the drafted text appears in the computed results."
            : `Number check: ${proposal.number_check.unmatched.length} figure(s) not found in the computed results.`}
          {edited != null && " You have edited the draft since; your edits are not checked."}
        </p>
      )}
      {stale && (
        <p className="notice" role="alert">
          Your priorities changed after this draft was written, so its recommendation may be out of date.{" "}
          <button className="link" onClick={() => generate(true)}>
            Regenerate
          </button>
        </p>
      )}
      {proposal?.source === "template" && (
        <p className="note">
          Template draft: the language model was unavailable, so this was assembled directly from the results. Try
          Regenerate in a moment for a written draft.
        </p>
      )}
      {proposal?.source === "cache" && <p className="note">Saved draft for this plan and the default priorities.</p>}
      {status.kind === "error" && (
        <p className="notice" role="alert">
          {status.message}
        </p>
      )}
      {proposal && editing && (
        <label className="edit-area">
          <span className="sr-only">Edit proposal Markdown</span>
          <textarea value={text} onChange={(e) => setEdited(e.target.value)} rows={24} />
        </label>
      )}
      {proposal && !editing && (
        <article className="markdown">
          <ReactMarkdown>{text}</ReactMarkdown>
        </article>
      )}

      <section className="qa-box" aria-labelledby="qa-h">
        <h3 id="qa-h">Ask about these results</h3>
        <p className="fine">
          Answers use only this analysis and say when something is not modeled. Short by default; ask for more detail on
          any answer.
        </p>
        <div className="suggest" aria-label="Suggested questions">
          {suggestions.map((q) => (
            <button key={q} className="suggest-q" disabled={askState.kind === "loading"} onClick={() => ask(q)}>
              {q}
            </button>
          ))}
        </div>
        <form
          className="ask"
          onSubmit={(e) => {
            e.preventDefault();
            ask(question);
          }}
        >
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask a question about these results"
            aria-label="Question about the results"
            maxLength={500}
          />
          <button type="submit" disabled={askState.kind === "loading" || !question.trim()}>
            {askState.kind === "loading" ? "Answering…" : "Ask"}
          </button>
        </form>
        <div role="status" aria-live="polite" className="live">
          {askState.kind === "loading" && "Answering…"}
        </div>
        {askState.kind === "error" && (
          <p className="notice" role="alert">
            {askState.message} Your question is kept; try again.
          </p>
        )}
        {answers.map((x, i) => (
          <div key={i} className="qa">
            <div className="q">{x.q}</div>
            <div className="a">
              <ReactMarkdown>{x.a}</ReactMarkdown>
              {x.check && (
                <p className={`check small ${x.check.passed ? "ok" : "warn"}`}>
                  {x.check.passed
                    ? "Number check passed."
                    : `Number check: ${x.check.unmatched.join(", ")} not found in the results.`}
                </p>
              )}
              {!x.detail && (
                <button className="link" onClick={() => ask(x.q, true)} disabled={askState.kind === "loading"}>
                  More detail
                </button>
              )}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
