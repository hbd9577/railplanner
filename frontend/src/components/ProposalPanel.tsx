import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { ApiError, api, type NumberCheck, type ProposalResult } from "../api";

interface Props {
  requestId: number | null;
  suggestions: string[];
}

type Status = { kind: "idle" } | { kind: "loading" } | { kind: "error"; message: string };

function errorText(e: unknown, fallback: string): string {
  if (e instanceof ApiError && e.status === 503) return e.message;
  return e instanceof Error ? `${fallback}: ${e.message}` : fallback;
}

export default function ProposalPanel({ requestId, suggestions }: Props) {
  const [proposal, setProposal] = useState<ProposalResult | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [voiceOk, setVoiceOk] = useState(false); // shown only when the API reports voice is configured
  const [voiceState, setVoiceState] = useState<"idle" | "loading" | "playing">("idle");
  const [question, setQuestion] = useState("");
  const [answers, setAnswers] = useState<{ q: string; a: string; check?: NumberCheck }[]>([]);
  const [askState, setAskState] = useState<Status>({ kind: "idle" });
  const audio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    api
      .features()
      .then((f) => setVoiceOk(!!f.voice))
      .catch(() => setVoiceOk(false));
  }, []);

  useEffect(() => {
    setProposal(null);
    setStatus({ kind: "idle" });
    setAnswers([]);
    audio.current?.pause();
  }, [requestId]);

  if (requestId == null) {
    return <p className="muted">Proposals need a stored plan. Reconnect the database and plan again.</p>;
  }

  async function generate(refresh: boolean) {
    setStatus({ kind: "loading" });
    try {
      setProposal(await api.proposal(requestId!, refresh));
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

  async function ask(e: React.FormEvent | null, preset?: string) {
    e?.preventDefault();
    const q = (preset ?? question).trim();
    if (!q) return;
    setAskState({ kind: "loading" });
    try {
      const { answer, number_check } = await api.ask(requestId!, q);
      setAnswers((xs) => [...xs, { q, a: answer, check: number_check }]);
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
        <button className="primary" onClick={() => generate(!!proposal)} disabled={status.kind === "loading"}>
          {status.kind === "loading" ? (
            <>
              <span className="spinner" /> Drafting proposal…
            </>
          ) : proposal ? (
            "Regenerate proposal"
          ) : (
            "Generate proposal"
          )}
        </button>
        {proposal && voiceOk && (
          <button onClick={() => listen(summary)} disabled={voiceState === "loading"}>
            {voiceState === "loading" ? (
              <>
                <span className="spinner dark" /> Preparing audio…
              </>
            ) : voiceState === "playing" ? (
              "Stop"
            ) : (
              "Listen to summary"
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
      {status.kind === "loading" && (
        <p className="note">Gemini is drafting from the computed results; this usually takes 10 to 30 seconds.</p>
      )}
      {proposal?.source === "template" && (
        <p className="note">
          Template draft: the language model was unavailable, so this was assembled directly from the results. Try
          Regenerate in a moment for a written draft.
        </p>
      )}
      {proposal?.source === "cache" && <p className="note">Saved draft for this plan. Regenerate for a new one.</p>}
      {status.kind === "error" && <p className="notice">{status.message}</p>}
      {proposal && (
        <article className="markdown">
          <ReactMarkdown>{proposal.markdown}</ReactMarkdown>
        </article>
      )}

      <form className="ask" onSubmit={ask}>
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask a question about these results"
          aria-label="Question about the results"
        />
        <button type="submit" disabled={askState.kind === "loading" || !question.trim()}>
          {askState.kind === "loading" ? "Answering…" : "Ask"}
        </button>
      </form>
      <div className="suggest" aria-label="Suggested questions">
        {suggestions.map((q) => (
          <button key={q} className="suggest-q" disabled={askState.kind === "loading"} onClick={() => ask(null, q)}>
            {q}
          </button>
        ))}
      </div>
      {askState.kind === "error" && <p className="notice">{askState.message}</p>}
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
            {voiceOk && (
              <button className="link" onClick={() => listen(x.a)}>
                Listen
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
