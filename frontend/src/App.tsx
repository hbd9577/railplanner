import { useEffect, useMemo, useRef, useState } from "react";
import { api, type City, type PlanResult } from "./api";
import AltCards from "./components/AltCards";
import ComparisonTab from "./components/ComparisonTab";
import CostsTab from "./components/CostsTab";
import DecisionSummary from "./components/DecisionSummary";
import FundingTab from "./components/FundingTab";
import ImpactsTab from "./components/ImpactsTab";
import MapPanel from "./components/MapPanel";
import type { Basemap, FitRequest, Layers } from "./components/MapView";
import MethodologyTab from "./components/MethodologyTab";
import PrioritiesPanel from "./components/PrioritiesPanel";
import ProposalPanel from "./components/ProposalPanel";
import ServiceTab from "./components/ServiceTab";
import Toolbar from "./components/Toolbar";
import { DEFAULT_WEIGHTS, rank, weightsEqual, type Weights } from "./scoring";
import { download, loadScenarios, queryFor, readUrl, reportHtml, storeScenarios, type Scenario } from "./scenario";
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
  const [animate, setAnimate] = useState(false);
  const [replayKey, setReplayKey] = useState(0);
  const [basemap, setBasemap] = useState<Basemap>("light");
  const [layers, setLayers] = useState<Layers>({ rail: false, protected: false, terrain: false, labels: true });
  const [fit, setFit] = useState<FitRequest>({ kind: "all", n: 0 });
  const [saved, setSaved] = useState<Scenario[]>(() => loadScenarios());
  const [message, setMessage] = useState<string | null>(null);

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
    const t = setTimeout(() => setMessage(null), 4000);
    return () => clearTimeout(t);
  }, [message]);

  async function runPlan(o: number, d: number, fresh = false, selKey?: string | null) {
    const keepKey = selKey ?? (plan && plan.origin.id === o && plan.destination.id === d ? plan.routes[selected]?.key : null);
    setOriginId(o);
    setDestId(d);
    setLoading(true);
    setError(null);
    try {
      const p = await api.plan(o, d, fresh);
      const idx = keepKey ? p.routes.findIndex((r) => r.key === keepKey) : -1;
      setPlan(p);
      setSelected(idx >= 0 ? idx : 0);
      setFit({ kind: "all", n: Date.now() });
      if (fresh) setMessage("Routing and simulations rerun from scratch.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Planning failed");
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
    setSaved(next);
    setMessage(storeScenarios(next) ? "Scenario saved in this browser." : "Could not save: browser storage is unavailable.");
  }

  function loadScenario(s: Scenario) {
    setWeights({ ...DEFAULT_WEIGHTS, ...s.w });
    runPlan(s.from, s.to, false, s.sel);
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

  function exportReport() {
    if (!plan) return;
    const slug = `${plan.origin.name}-${plan.destination.name}`.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    download(`railplanner-${slug}.html`, reportHtml(plan, weights, selected, window.location.href));
    setMessage("Report downloaded as an HTML file.");
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

  const mapPanel = (
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
    />
  );

  return (
    <div className="page">
      <Toolbar
        cities={cities}
        originId={originId}
        destId={destId}
        onOrigin={setOriginId}
        onDest={setDestId}
        onSwap={() => {
          setOriginId(destId);
          setDestId(originId);
        }}
        onCompare={() => canCompare && runPlan(originId!, destId!)}
        canCompare={canCompare}
        loading={loading}
        upToDate={upToDate}
        picking={pickStep !== "off"}
        onPick={() => {
          setPickStep(pickStep === "off" ? "origin" : "off");
          setTab("overview");
        }}
        hasPlan={!!plan}
        prioritiesOpen={prioritiesOpen}
        customWeights={!weightsEqual(weights, DEFAULT_WEIGHTS)}
        onPriorities={() => setPrioritiesOpen((o) => !o)}
        onRerun={() => plan && runPlan(plan.origin.id, plan.destination.id, true)}
        onSave={save}
        onShare={share}
        onExport={exportReport}
        saved={saved}
        onLoad={loadScenario}
        onDelete={removeScenario}
        message={message}
      />

      {error && (
        <div className="notice page-notice" role="alert">
          {error}
        </div>
      )}

      {plan && prioritiesOpen && (
        <div className="drawer">
          <PrioritiesPanel routes={plan.routes} weights={weights} onChange={setWeights} onClose={() => setPrioritiesOpen(false)} />
        </div>
      )}

      {!plan ? (
        <main className="workspace empty">
          <section className="intro">
            <h1>Compare passenger rail corridor alternatives</h1>
            <p>
              Choose an origin and a destination above, or pick two cities on the map. RailPlanner draws three
              conceptual alignments, simulates their capital cost and time to opening, and screens federal funding fit.
            </p>
            <p className="fine">
              It is a screening tool. Costs use illustrative, uncalibrated benchmarks, and train service, ridership and
              operating costs are not modeled yet.
            </p>
            {loading && <p role="status">Generating alternatives and running simulations…</p>}
          </section>
          {mapPanel}
        </main>
      ) : (
        <main className="workspace">
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

          <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
            {tab === "overview" && (
              <div className="tab-body">
                <div className="overview-grid">
                  <DecisionSummary
                    plan={plan}
                    weights={weights}
                    defaultWeights={weightsEqual(weights, DEFAULT_WEIGHTS)}
                    onOpenPriorities={() => {
                      setPrioritiesOpen(true);
                      window.scrollTo({ top: 0 });
                    }}
                    onOpenTab={(t) => isTab(t) && setTab(t)}
                  />
                  {mapPanel}
                </div>
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
            {tab === "funding" && <FundingTab plan={plan} selected={selected} onSelect={setSelected} />}
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
                  <ProposalPanel requestId={plan.request_id} suggestions={suggestedQuestions(plan, selected)} />
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
