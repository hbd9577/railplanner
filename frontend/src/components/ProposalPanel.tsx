import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { ApiError, api, type ProposalResult } from "../api";

interface Props {
  requestId: number | null;
}

type Status = { kind: "idle" } | { kind: "loading" } | { kind: "error"; message: string };

function errorText(e: unknown, fallback: string): string {
  if (e instanceof ApiError && e.status === 503) return e.message;
  return e instanceof Error ? `${fallback}: ${e.message}` : fallback;
}

export default function ProposalPanel({ requestId }: Props) {
  const [proposal, setProposal] = useState<ProposalResult | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [voiceOk, setVoiceOk] = useState(true);
  const [voiceState, setVoiceState] = useState<"idle" | "loading" | "playing">("idle");
  const [question, setQuestion] = useState("");
  const [answers, setAnswers] = useState<{ q: string; a: string }[]>([]);
  const [askState, setAskState] = useState<Status>({ kind: "idle" });
  const audio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    setProposal(null);
    setStatus({ kind: "idle" });
    setAnswers([]);
    audio.current?.pause();
  }, [requestId]);

  if (requestId == null) {
    return <p className="muted">Proposals need a stored plan. Reconnect the database and plan again.</p>;
  }

  async function generate() {
    setStatus({ kind: "loading" });
    try {
      setProposal(await api.proposal(requestId!));
      setStatus({ kind: "idle" });
    } catch (e) {
      setStatus({ kind: "error", message: errorText(e, "Could not generate the proposal") });
    }
  }

  async function listen(text: string) {
    if (voiceState === "playing") {
      audio.current?.pause();
      setVoiceState("idle");
      return;
    }
    setVoiceState("loading");
    try {
      const blob = await api.voice(text);
      audio.current?.pause();
      audio.current = new Audio(URL.createObjectURL(blob));
      audio.current.onended = () => setVoiceState("idle");
      await audio.current.play();
      setVoiceState("playing");
    } catch {
      setVoiceOk(false); // hide the button when narration isn't available
      setVoiceState("idle");
    }
  }

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    const q = question.trim();
    if (!q) return;
    setAskState({ kind: "loading" });
    try {
      const { answer } = await api.ask(requestId!, q);
      setAnswers((xs) => [...xs, { q, a: answer }]);
      setQuestion("");
      setAskState({ kind: "idle" });
    } catch (err) {
      setAskState({ kind: "error", message: errorText(err, "Could not answer") });
    }
  }

  const summary = proposal?.markdown.split(/\n## /)[1]?.replace(/^[^\n]*\n/, "") ?? proposal?.markdown ?? "";

  return (
    <div className="proposal">
      <div className="proposal-actions">
        <button className="btn btn-primary" onClick={generate} disabled={status.kind === "loading"}>
          {status.kind === "loading" ? (
            <>
              Drafting proposal…
            </>
          ) : proposal ? (
            "Regenerate proposal"
          ) : (
            "Generate proposal"
          )}
        </button>
        {proposal && voiceOk && (
          <button className="btn" onClick={() => listen(summary)} disabled={voiceState === "loading"}>
            {voiceState === "loading" ? (
              <>
                Preparing audio…
              </>
            ) : voiceState === "playing" ? (
              "Stop narration"
            ) : (
              "Read summary aloud"
            )}
          </button>
        )}
        {proposal?.number_check && (
          <span className={`check ${proposal.number_check.passed ? "ok" : "warn"}`}>
            {proposal.number_check.passed
              ? "Number check passed: every figure appears in the computed results."
              : `Number check: ${proposal.number_check.unmatched.length} figure(s) not found in the computed results.`}
          </span>
        )}
      </div>
      {status.kind === "error" && <p className="notice">{status.message}</p>}
      {proposal && (
        <article className="markdown">
          <ReactMarkdown>{proposal.markdown}</ReactMarkdown>
        </article>
      )}

      <form className="ask" onSubmit={ask}>
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask about these results, e.g. Why is route 2 cheaper?"
          aria-label="Question about the results"
        />
        <button type="submit" className="btn" disabled={askState.kind === "loading" || !question.trim()}>
          {askState.kind === "loading" ? "Answering…" : "Ask"}
        </button>
      </form>
      {askState.kind === "error" && <p className="notice">{askState.message}</p>}
      {answers.map((x, i) => (
        <div key={i} className="qa">
          <div className="q">{x.q}</div>
          <div className="a">
            <ReactMarkdown>{x.a}</ReactMarkdown>
            {voiceOk && (
              <button className="btn-text" onClick={() => listen(x.a)}>
                Read this answer aloud
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
