import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, api, type City, type PlanResult } from "./api";
import AltCards from "./components/AltCards";
import BaselinePanel from "./components/BaselinePanel";
import ComparisonTab from "./components/ComparisonTab";
import CostsTab from "./components/CostsTab";
import DecisionSummary, { HeroSummary } from "./components/DecisionSummary";
import FundingTab from "./components/FundingTab";
import ImpactsTab from "./components/ImpactsTab";
import MapPanel, { StationsList } from "./components/MapPanel";
import type { Basemap, FitRequest, Layers } from "./components/MapView";
import MethodologyTab from "./components/MethodologyTab";
import PrioritiesPanel from "./components/PrioritiesPanel";
import ProposalPanel from "./components/ProposalPanel";
import ServiceTab from "./components/ServiceTab";
import { CorridorControls, ScenarioActions, type ToolbarProps } from "./components/Toolbar";
import { DEFAULT_WEIGHTS, encodeWeights as encodeW, rank, weightsEqual, type Weights } from "./scoring";
import {
  download,
  loadScenarios,
  printDocument,
  queryFor,
  readUrl,
  reportHtml,
  resultsCsv,
  scenarioPayload,
  storeScenarios,
  type Scenario,
} from "./scenario";
import { suggestedQuestions } from "./summary";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "service", label: "Service & demand" },
  { id: "comparison", label: "Comparison" },
  { id: "costs", label: "Costs & schedule" },
  { id: "impacts", label: "Impacts" },
  { id: "funding", label: "Funding" },
  { id: "proposal", label: "Proposal & questions" },
  { id: "methodology", label: "Methodology" },
] as const;
type TabId = (typeof TABS)[number]["id"];
const isTab = (t: string | null): t is TabId => TABS.some((x) => x.id === t);

export default function App() {
  const initial = useRef(readUrl());
  const [cities, setCities] = useState<City[]>([]);
  const [originId, setOriginId] = useState<number | null>(initial.current.from);
  const [destId, setDestId] = useState<number | null>(initial.current.to);
  const [plan, setPlan] = useState<PlanResult | null>(null);
  const [selected, setSelected] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>(isTab(initial.current.tab) ? initial.current.tab : "overview");
  const [weights, setWeights] = useState<Weights>(initial.current.w ?? { ...DEFAULT_WEIGHTS });
  const [prioritiesOpen, setPrioritiesOpen] = useState(false);
  const [pickStep, setPickStep] = useState<"off" | "origin" | "dest">("off");
  const [animate, setAnimate] = useState(true); // track-building animation (finished track under reduced motion)
  const [replayKey, setReplayKey] = useState(0);
  const [basemap, setBasemap] = useState<Basemap>("satellite");
  const [layers, setLayers] = useState<Layers>({ rail: false, protected: false, terrain: false, labels: true });
  const [fit, setFit] = useState<FitRequest>({ kind: "all", n: 0 });
  const [saved, setSaved] = useState<Scenario[]>(() => loadScenarios());
  const [message, setMessage] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [lastAttempt, setLastAttempt] = useState<{ o: number; d: number; fresh: boolean } | null>(null);
  const [savedSig, setSavedSig] = useState<string | null>(null);
  const [baseline, setBaseline] = useState<Scenario | null>(null);

  useEffect(() => {
    api
      .cities()
      .then((cs) => {
        setCities(cs);
        const { from, to, sel } = initial.current;
        if (from != null && to != null && from !== to && cs.some((c) => c.id === from) && cs.some((c) => c.id === to))
          runPlan(from, to, false, sel);
      })
      .catch((e) => setError(`Could not reach the API (${e.message}).`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the address bar in step with the scenario so Share and reload reproduce it.
  useEffect(() => {
    if (!plan) return;
    const q = queryFor({ from: plan.origin.id, to: plan.destination.id, sel: plan.routes[selected]?.key, tab, w: weightsEqual(weights, DEFAULT_WEIGHTS) ? undefined : weights });
    window.history.replaceState(null, "", q);
  }, [plan, selected, tab, weights]);

  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), 6000);
    return () => clearTimeout(t);
  }, [message]);

  // Elapsed time while a corridor is computed (there is no server-side progress to report).
  useEffect(() => {
    if (!loading) return;
    setElapsed(0);
    const t = setInterval(() => setElapsed((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [loading]);

  async function runPlan(o: number, d: number, fresh = false, selKey?: string | null) {
    const keepKey = selKey ?? (plan && plan.origin.id === o && plan.destination.id === d ? plan.routes[selected]?.key : null);
    setOriginId(o);
    setDestId(d);
    setLoading(true);
    setError(null);
    setLastAttempt({ o, d, fresh });
    try {
      const p = await api.plan(o, d, fresh);
      const idx = keepKey ? p.routes.findIndex((r) => r.key === keepKey) : -1;
      setPlan(p);
      setSelected(idx >= 0 ? idx : 0);
      setFit({ kind: "all", n: Date.now() });
      setMessage(
        fresh
          ? "Routing and simulations rerun from scratch."
          : `Results ready for ${p.origin.name} to ${p.destination.name}: ${p.routes.length} alternatives.`,
      );
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500)
        setError(`This corridor could not be planned: ${e.message}. Try a different pair of cities.`);
      else if (e instanceof ApiError)
        setError(`The calculation failed on the server (${e.message}). Your inputs are kept; try again.`);
      else setError("Could not reach the RailPlanner server. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  function onCityPick(id: number) {
    if (pickStep === "origin") {
      setOriginId(id);
      if (destId === id) setDestId(null);
      setPickStep("dest");
    } else if (pickStep === "dest" && id !== originId) {
      setDestId(id);
      setPickStep("off");
      if (originId != null) runPlan(originId, id);
    }
  }

  const leader = useMemo(() => (plan ? rank(plan.routes, weights)[0].index : null), [plan, weights]);
  const canCompare = originId != null && destId != null && originId !== destId;
  const upToDate = !!plan && plan.origin.id === originId && plan.destination.id === destId;
  const corridorName = plan ? `${plan.origin.name}–${plan.destination.name}` : "";

  const sigOf = (from: number, to: number, sel: string, w: Weights) => JSON.stringify([from, to, sel, encodeW(w)]);
  const currentSig = plan ? sigOf(plan.origin.id, plan.destination.id, plan.routes[selected]?.key ?? "", weights) : null;
  const unsaved = savedSig != null && currentSig !== savedSig;

  function save() {
    if (!plan) return;
    const s: Scenario = {
      name: `${corridorName}, ${plan.routes[selected].label}${weightsEqual(weights, DEFAULT_WEIGHTS) ? "" : ", custom priorities"}`,
      from: plan.origin.id,
      to: plan.destination.id,
      sel: plan.routes[selected].key,
      w: weights,
      savedAt: new Date().toISOString(),
    };
    const next = [s, ...saved];
    if (storeScenarios(next)) {
      setSaved(next);
      setSavedSig(sigOf(s.from, s.to, s.sel, s.w));
      setMessage("Scenario saved in this browser.");
    } else {
      setMessage("Could not save: browser storage is unavailable (for example in a private window).");
    }
  }

  function loadScenario(s: Scenario) {
    const w = { ...DEFAULT_WEIGHTS, ...s.w };
    setWeights(w);
    setSavedSig(sigOf(s.from, s.to, s.sel, w));
    runPlan(s.from, s.to, false, s.sel);
  }

  function startOver() {
    if (unsaved && !window.confirm("Discard unsaved changes and start over?")) return;
    setPlan(null);
    setOriginId(null);
    setDestId(null);
    setWeights({ ...DEFAULT_WEIGHTS });
    setSelected(0);
    setTab("overview");
    setBaseline(null);
    setSavedSig(null);
    setError(null);
    setPrioritiesOpen(false);
    setPickStep("off");
    window.history.replaceState(null, "", window.location.pathname);
    setMessage("Cleared. Choose a new corridor.");
  }

  function removeScenario(s: Scenario) {
    const next = saved.filter((x) => x.savedAt !== s.savedAt);
    setSaved(next);
    storeScenarios(next);
  }

  async function share() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setMessage("Link copied. It reopens this corridor, selection, tab and priorities.");
    } catch {
      setMessage(`Copy this link: ${window.location.href}`);
    }
  }

  const fileStem = plan ? `railplanner-${plan.origin.name}-${plan.destination.name}`.toLowerCase().replace(/[^a-z0-9]+/g, "-") : "railplanner";

  function exportAs(kind: "html" | "pdf" | "csv") {
    if (!plan) return;
    try {
      if (kind === "csv") {
        download(`${fileStem}.csv`, resultsCsv(plan, weights), "text/csv");
        setMessage("Results downloaded as CSV.");
      } else if (kind === "html") {
        download(`${fileStem}.html`, reportHtml(plan, weights, selected, window.location.href));
        setMessage("Report downloaded as an HTML file.");
      } else {
        const ok = printDocument(reportHtml(plan, weights, selected, window.location.href));
        setMessage(ok ? "Print dialog opened: choose “Save as PDF”." : "Could not open the print window. Allow pop-ups for this site and try again.");
      }
    } catch {
      setMessage("Export failed in this browser. Try another format.");
    }
  }

  function onTabKey(e: React.KeyboardEvent) {
    const i = TABS.findIndex((t) => t.id === tab);
    const n = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : null;
    if (n == null) return;
    e.preventDefault();
    const next = TABS[(n + TABS.length) % TABS.length].id;
    setTab(next);
    document.getElementById(`tab-${next}`)?.focus();
  }

  const openTab = (t: string) => {
    if (!isTab(t)) return;
    setTab(t);
    document.getElementById("workspace")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const openPriorities = () => {
    setPrioritiesOpen(true);
    document.getElementById("workspace")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const toolbar: ToolbarProps = {
    cities,
    originId,
    destId,
    onOrigin: setOriginId,
    onDest: setDestId,
    onSwap: () => {
      setOriginId(destId);
      setDestId(originId);
    },
    onCompare: () => canCompare && runPlan(originId!, destId!),
    canCompare,
    loading,
    upToDate,
    picking: pickStep !== "off",
    onPick: () => setPickStep(pickStep === "off" ? "origin" : "off"),
    hasPlan: !!plan,
    prioritiesOpen,
    customWeights: !weightsEqual(weights, DEFAULT_WEIGHTS),
    onPriorities: () => setPrioritiesOpen((o) => !o),
    onRerun: () => plan && runPlan(plan.origin.id, plan.destination.id, true),
    onSave: save,
    unsaved,
    onShare: share,
    onExport: exportAs,
    onStartOver: startOver,
    saved,
    onLoad: loadScenario,
    onCompareWith: (s) => {
      setBaseline(s);
      openTab("overview");
    },
    onDelete: removeScenario,
  };

  return (
    <div className="page">
      <MapPanel
        cities={cities}
        plan={plan}
        originId={originId}
        destId={destId}
        selected={selected}
        leader={leader}
        pickStep={pickStep}
        loading={loading}
        animate={animate}
        replayKey={replayKey}
        basemap={basemap}
        layers={layers}
        fit={fit}
        onCityPick={onCityPick}
        onCancelPick={() => setPickStep("off")}
        onSelect={setSelected}
        onFit={(kind) => setFit({ kind, n: Date.now() })}
        onBasemap={setBasemap}
        onLayers={setLayers}
        onAnimate={setAnimate}
        onReplay={() => setReplayKey((k) => k + 1)}
      >
        <div className="brand">
          <span className="wordmark">RailPlanner</span>
          <span className="tb-tag">Passenger rail corridor screening</span>
        </div>
        <CorridorControls {...toolbar} />
        <div className="live-bar" role="status" aria-live="polite">
          {loading
            ? `Generating alternatives and running simulations… ${elapsed} s${elapsed > 20 ? " (new corridors can take up to a minute)" : ""}`
            : message}
        </div>
        {error && (
          <div className="notice" role="alert">
            {error}{" "}
            {lastAttempt && (
              <button className="link" onClick={() => runPlan(lastAttempt.o, lastAttempt.d, lastAttempt.fresh)} disabled={loading}>
                Try again
              </button>
            )}
          </div>
        )}
        {plan ? (
          <HeroSummary
            plan={plan}
            weights={weights}
            defaultWeights={weightsEqual(weights, DEFAULT_WEIGHTS)}
            onOpenPriorities={openPriorities}
            onOpenTab={openTab}
          />
        ) : (
          <section className="intro">
            <h1>Compare passenger rail corridor alternatives</h1>
            <p>
              Choose an origin and a destination, or pick two cities on the map. RailPlanner draws three conceptual
              alignments, simulates their capital cost and time to opening, and screens federal funding fit.
            </p>
            <p className="fine">
              A screening tool: costs use illustrative, uncalibrated benchmarks, and train service, ridership and
              operating costs are not modeled yet.
            </p>
          </section>
        )}
      </MapPanel>

      {plan && (
        <div className="actions-bar" id="workspace">
          <div className="tabs" role="tablist" aria-label="Analysis views" onKeyDown={onTabKey}>
            {TABS.map((t) => (
              <button
                key={t.id}
                id={`tab-${t.id}`}
                role="tab"
                aria-selected={tab === t.id}
                aria-controls={`panel-${t.id}`}
                tabIndex={tab === t.id ? 0 : -1}
                className={tab === t.id ? "on" : ""}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <ScenarioActions {...toolbar} />
        </div>
      )}

      {plan && prioritiesOpen && (
        <div className="drawer">
          <PrioritiesPanel routes={plan.routes} weights={weights} onChange={setWeights} onClose={() => setPrioritiesOpen(false)} />
        </div>
      )}

      {plan && (
        <main className="workspace">
          <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
            {tab === "overview" && (
              <div className="tab-body">
                <div className="overview-grid">
                  <DecisionSummary
                    plan={plan}
                    weights={weights}
                    defaultWeights={weightsEqual(weights, DEFAULT_WEIGHTS)}
                    onOpenPriorities={openPriorities}
                    onOpenTab={openTab}
                  />
                  <StationsList plan={plan} selected={selected} />
                </div>
                {baseline && (
                  <BaselinePanel baseline={baseline} plan={plan} weights={weights} selected={selected} onClose={() => setBaseline(null)} />
                )}
                <h2 className="section-h">The alternatives</h2>
                <AltCards routes={plan.routes} selected={selected} leader={leader ?? 0} onSelect={setSelected} />
              </div>
            )}
            {tab === "service" && <ServiceTab plan={plan} selected={selected} onSelect={setSelected} />}
            {tab === "comparison" && (
              <ComparisonTab routes={plan.routes} selected={selected} leader={leader ?? 0} onSelect={setSelected} />
            )}
            {tab === "costs" && <CostsTab key={plan.routes[selected].key + plan.request_id} plan={plan} selected={selected} onSelect={setSelected} />}
            {tab === "impacts" && <ImpactsTab plan={plan} selected={selected} onSelect={setSelected} />}
            {tab === "funding" && <FundingTab plan={plan} cities={cities} selected={selected} onSelect={setSelected} />}
            {tab === "proposal" && (
              <div className="tab-body">
                <header className="tab-head">
                  <div>
                    <h2>Proposal and questions</h2>
                    <p className="lede">
                      A draft written by a language model from the computed results only. Every figure in the draft
                      and in answers is checked against the results; anything not found is flagged.
                    </p>
                  </div>
                </header>
                <section className="panel">
                  <ProposalPanel
                    requestId={plan.request_id}
                    scenario={scenarioPayload(plan, weights, selected)}
                    suggestions={suggestedQuestions(plan, selected)}
                    fileStem={fileStem}
                  />
                </section>
              </div>
            )}
            {tab === "methodology" && <MethodologyTab plan={plan} weights={weights} onWeights={setWeights} />}
          </div>

          <footer className="foot">
            <span>
              Illustrative screening estimates. Not a budget, engineering estimate or funding determination.
            </span>
            <span>
              {plan.routes[0].simulation.source === "tiger_cagg" ? "Results stored in Tiger Data" : "Results computed locally"}
              {" · "}model {plan.model_version || "unknown"}
            </span>
          </footer>
        </main>
      )}
    </div>
  );
}
