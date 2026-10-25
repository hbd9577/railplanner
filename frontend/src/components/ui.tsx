// Small shared pieces: alternative badges, status chips, and on-demand metric definitions.
import { useEffect, useId, useRef, useState } from "react";
import type { RouteResult } from "../api";
import { altStyle } from "../format";
import { STATUS_HELP, STATUS_LABEL, type Metric, type Status } from "../metrics";

/** Route identity: number in a colored square plus a short line sample in the route's pattern. */
export function AltBadge({ i, rank, withLine = false }: { i: number; rank: number; withLine?: boolean }) {
  const s = altStyle(i);
  return (
    <span className="alt-badge" aria-hidden="true">
      <span className="alt-num" style={{ background: s.color }}>
        {rank}
      </span>
      {withLine && (
        <svg width="26" height="8" className="alt-line">
          <line x1="1" y1="4" x2="25" y2="4" stroke={s.color} strokeWidth="3" strokeDasharray={s.dash} strokeLinecap={s.pattern === "dotted" ? "round" : "butt"} />
        </svg>
      )}
    </span>
  );
}

export function AltName({ r, i, withLine = false }: { r: RouteResult; i: number; withLine?: boolean }) {
  return (
    <span className="alt-name">
      <AltBadge i={i} rank={r.rank} withLine={withLine} />
      <span>{r.label}</span>
    </span>
  );
}

export function StatusChip({ status }: { status: Status }) {
  return (
    <span className={`chip chip-${status}`} title={STATUS_HELP[status]}>
      {STATUS_LABEL[status]}
    </span>
  );
}

/** "About this measure": definition, units, status, provenance, assumptions, uncertainty, limitations. */
export function MetricInfo({ m }: { m: Metric }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  return (
    <span className="info" ref={ref}>
      <button
        type="button"
        className="info-btn"
        aria-expanded={open}
        aria-controls={id}
        aria-label={`About ${m.label}`}
        onClick={() => setOpen((o) => !o)}
      >
        ?
      </button>
      {open && (
        <span className="info-pop" id={id} role="note">
          <strong>{m.label}</strong>
          <span>{m.definition}</span>
          <span className="info-grid">
            <span>Units</span>
            <span>{m.unit}</span>
            <span>Status</span>
            <span>{STATUS_LABEL[m.status]}</span>
            <span>Preferred</span>
            <span>{m.direction === "lower" ? "Lower" : m.direction === "higher" ? "Higher" : "Depends on context"}</span>
            <span>Source</span>
            <span>{m.source}</span>
            <span>Data year</span>
            <span>{m.dataYear}</span>
            <span>Coverage</span>
            <span>{m.coverage}</span>
            <span>Method</span>
            <span>{m.method}</span>
            <span>Assumes</span>
            <span>{m.assumptions}</span>
            <span>Uncertainty</span>
            <span>{m.uncertainty}</span>
            <span>Limitations</span>
            <span>{m.limitations}</span>
          </span>
        </span>
      )}
    </span>
  );
}

export function Direction({ d }: { d: Metric["direction"] }) {
  return (
    <span className="dir" title={d === "context" ? "Neither higher nor lower is always better" : `${d === "lower" ? "Lower" : "Higher"} is better`}>
      {d === "lower" ? "Lower is better" : d === "higher" ? "Higher is better" : "Context"}
    </span>
  );
}
