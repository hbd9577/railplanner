// Scenario state that survives a reload or a shared link: corridor, selected alternative, tab and
// priority weights. Saved scenarios live in this browser only (localStorage).
import { DEFAULT_SERVICE, type PlanResult, type ScenarioPayload, type ServicePlan } from "./api";
import { usd, years, people, miles, pct } from "./format";
import { METRICS, NOT_MODELED, STATUS_LABEL } from "./metrics";
import { DEFAULT_WEIGHTS, PRIORITIES, decodeWeights, encodeWeights, missingPriorities, rank, weightsEqual, type Weights } from "./scoring";
import { decisionSummary } from "./summary";

export interface Scenario {
  name: string;
  from: number;
  to: number;
  sel: string; // alternative key, stable across reruns
  w: Weights;
  svc?: ServicePlan;
  savedAt: string;
}

export interface UrlState {
  from: number | null;
  to: number | null;
  sel: string | null;
  tab: string | null;
  w: Weights | null;
  svc: ServicePlan | null;
}

export function encodeService(p: ServicePlan): string {
  return `${p.round_trips}.${p.max_mph_existing}.${p.max_mph_new}`;
}

export function decodeService(s: string | null): ServicePlan | null {
  if (!s) return null;
  const [rt, ex, nw] = s.split(".").map(Number);
  if (![rt, ex, nw].every(Number.isFinite) || rt < 1 || rt > 40 || ex < 40 || ex > 125 || nw < 60 || nw > 220) return null;
  return { round_trips: Math.round(rt), max_mph_existing: ex, max_mph_new: nw };
}

export const isDefaultService = (p: ServicePlan) => encodeService(p) === encodeService(DEFAULT_SERVICE);

export function readUrl(): UrlState {
  const q = new URLSearchParams(window.location.search);
  const n = (k: string) => (q.get(k) && Number.isFinite(Number(q.get(k))) ? Number(q.get(k)) : null);
  return {
    from: n("from"),
    to: n("to"),
    sel: q.get("sel"),
    tab: q.get("tab"),
    w: decodeWeights(q.get("w")),
    svc: decodeService(q.get("svc")),
  };
}

export function queryFor(s: { from: number; to: number; sel?: string; tab?: string; w?: Weights; svc?: ServicePlan }): string {
  const q = new URLSearchParams({ from: String(s.from), to: String(s.to) });
  if (s.sel) q.set("sel", s.sel);
  if (s.tab && s.tab !== "overview") q.set("tab", s.tab);
  if (s.w) q.set("w", encodeWeights(s.w));
  if (s.svc && !isDefaultService(s.svc)) q.set("svc", encodeService(s.svc));
  return `?${q.toString()}`;
}

const KEY = "railplanner.scenarios.v1";

export function loadScenarios(): Scenario[] {
  try {
    const raw = localStorage.getItem(KEY);
    const xs = raw ? (JSON.parse(raw) as Scenario[]) : [];
    return Array.isArray(xs) ? xs : [];
  } catch {
    return [];
  }
}

export function storeScenarios(xs: Scenario[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(xs.slice(0, 30)));
    return true;
  } catch {
    return false;
  }
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function svcLine(plan: PlanResult): string {
  const sv = plan.routes.find((r) => r.service && r.service.available)?.service;
  if (!sv) return "";
  return `<h2>Service plan used for estimates</h2><p>${sv.round_trips} daily round trips; top speed ${sv.max_mph_existing} mph on existing rail and ${sv.max_mph_new} mph on new track; every train stops at every station. Ridership, revenue, operating cost, subsidy, benefit-cost ratio and CO2 are preliminary model estimates (medians shown in the comparison above).</p>`;
}

/** A self-contained HTML report of the active scenario, including the weights used. */
export function reportHtml(plan: PlanResult, weights: Weights, selected: number, link: string): string {
  const s = decisionSummary(plan, weights);
  const ranked = rank(plan.routes, weights);
  const total = PRIORITIES.reduce((a, p) => a + (weights[p.id] ?? 0), 0) || 1;
  const routes = plan.routes;
  const corridor = `${plan.origin.name}, ${plan.origin.state} to ${plan.destination.name}, ${plan.destination.state}`;
  const th = routes.map((r) => `<th>${r.rank}. ${esc(r.label)}</th>`).join("");
  const metricRows = METRICS.map(
    (m) => `<tr><th>${esc(m.label)}<br><small>${STATUS_LABEL[m.status]}</small></th>${routes.map((r) => `<td>${esc(m.fmt(m.get(r)))}</td>`).join("")}</tr>`,
  ).join("");
  const rangeRows = routes
    .map((r) => {
      const c = r.simulation.cost;
      const d = r.simulation.duration;
      return `<tr><th>${r.rank}. ${esc(r.label)}</th><td>${usd(c.p10)}</td><td><b>${usd(c.p50)}</b></td><td>${usd(c.p90)}</td><td>${years(d.p10)}</td><td><b>${years(d.p50)}</b></td><td>${years(d.p90)}</td></tr>`;
    })
    .join("");
  const sel = routes[selected];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>RailPlanner report: ${esc(corridor)}</title>
<style>body{font:15px/1.55 system-ui,sans-serif;color:#111827;max-width:920px;margin:32px auto;padding:0 16px}
h1{font-size:26px;margin:0 0 4px}h2{font-size:19px;margin:28px 0 8px;border-bottom:1px solid #d1d5db;padding-bottom:4px}
table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums;margin:8px 0}th,td{border-bottom:1px solid #e5e7eb;padding:6px 8px;text-align:left;vertical-align:top}
td{text-align:right}small{color:#6b7280;font-weight:400}.note{color:#4b5563;font-size:13px}.box{border:1px solid #d1d5db;background:#f9fafb;padding:12px 16px;margin:12px 0}</style></head><body>
<h1>${esc(corridor)}</h1>
<p class="note">RailPlanner screening report. Generated ${new Date().toLocaleString()} from model version ${esc(plan.model_version || "unknown")}. Live view: <a href="${esc(link)}">${esc(link)}</a></p>
<div class="box"><p><b>${esc(s.headline)}</b></p><p>${esc(s.cost)}<br>${esc(s.schedule)}</p>
<p>Why it leads: ${s.reasons.map(esc).join("; ")}.</p>${s.tradeoffs.length ? `<p>Main tradeoff: ${s.tradeoffs.map(esc).join("; ")}.</p>` : ""}
<p>${esc(s.nextStep)}</p></div>
<p class="note"><b>Illustrative estimates.</b> Cost benchmarks are uncalibrated. Ranges are the middle 80% of ${routes[0].simulation.runs.toLocaleString()} simulated outcomes and describe uncertainty inside the model only. A leading score does not show that a service would be useful, operable, fundable or feasible.</p>
<h2>Priorities used</h2><table><tr><th>Priority</th><td>Share of weight</td></tr>${PRIORITIES.map((p) => `<tr><th>${esc(p.label)}</th><td>${Math.round((100 * (weights[p.id] ?? 0)) / total)}%</td></tr>`).join("")}</table>
<table><tr><th>Ranking</th><td>Score (relative, 0–100)</td></tr>${ranked.map((x, k) => `<tr><th>${k + 1}. ${esc(routes[x.index].label)}</th><td>${x.score.toFixed(0)}</td></tr>`).join("")}</table>
<h2>Comparison</h2><table><tr><th>Measure</th>${th}</tr>${metricRows}</table>
<h2>Cost and schedule ranges (P10 / P50 / P90)</h2><table><tr><th>Alternative</th><td>Cost P10</td><td>Cost P50</td><td>Cost P90</td><td>Opening P10</td><td>Opening P50</td><td>Opening P90</td></tr>${rangeRows}</table>
<p class="note">Cost excludes rolling stock, maintenance facilities, electrification, host-railroad access payments, operating costs and financing. No cost year or escalation is applied.</p>
${svcLine(plan)}
<h2>Selected alternative: ${esc(sel.label)}</h2><p>${esc(sel.description)}</p>
<p>${miles(sel.stats.length_miles)}; ${pct(sel.stats.row_reuse_pct)} on existing rail corridors; ${people(sel.stats.pop_near_stations)} residents within ${sel.stats.station_catchment_km} km of a station. Stations in order: ${sel.stats.station_miles.map((x) => esc(x.name)).join(", ")}.</p>
<h2>Not modeled</h2><ul>${NOT_MODELED.map((g) => `<li><b>${esc(g.label)}.</b> ${esc(g.why)} <span class="note">Needs: ${esc(g.needs)}</span></li>`).join("")}</ul>
<h2>Assumptions</h2><ol>${plan.assumptions.map((a) => `<li>${esc(a)}</li>`).join("")}</ol>
<h2>Data sources</h2><ul>${Object.entries(plan.data_sources).map(([k, v]) => `<li><b>${esc(k.replace(/_/g, " "))}:</b> ${esc(v.source)}${v.flag !== "real" ? ` (${esc(v.flag)})` : ""}</li>`).join("")}</ul>
</body></html>`;
}

export function download(filename: string, content: string, type = "text/html"): void {
  const url = URL.createObjectURL(new Blob([content], { type: `${type};charset=utf-8` }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** What the proposal and Q&A endpoints need to reflect the active scenario. */
export function scenarioPayload(plan: PlanResult, weights: Weights, selected: number, svc: ServicePlan): ScenarioPayload {
  const ranked = rank(plan.routes, weights);
  const total = PRIORITIES.reduce((a, p) => a + (weights[p.id] ?? 0), 0) || 1;
  return {
    priorities: PRIORITIES.map((p) => ({ label: p.label, share_pct: Math.round((100 * (weights[p.id] ?? 0)) / total) })),
    ranking: ranked.map((x) => plan.routes[x.index].label),
    close_call: ranked.length > 1 && ranked[0].score - ranked[1].score < 3,
    excluded_priorities: missingPriorities(plan.routes).map((p) => p.label),
    selected: plan.routes[selected]?.label ?? null,
    is_default: weightsEqual(weights, DEFAULT_WEIGHTS) && isDefaultService(svc),
    service: isDefaultService(svc) ? null : svc,
  };
}

/** Opens a print-ready copy of a full HTML document; the browser's print dialog can save it as PDF. */
export function printDocument(html: string): boolean {
  const w = window.open("", "_blank");
  if (!w) return false;
  w.document.open();
  w.document.write(html.replace("</body>", "<script>window.onload=()=>{window.focus();window.print();}</script></body>"));
  w.document.close();
  return true;
}

export function printHtml(title: string, bodyHtml: string): boolean {
  return printDocument(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>body{font:15px/1.55 system-ui,sans-serif;color:#111827;max-width:800px;margin:24px auto;padding:0 16px}
h1{font-size:24px}h2{font-size:18px;margin-top:22px}blockquote{border-left:3px solid #92400e;margin:8px 0;padding:4px 12px;background:#fef6e7}
a{color:#0f5f6b}</style></head><body>${bodyHtml}</body></html>`);
}

const csvCell = (v: string | number) => {
  const t = String(v);
  return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

/** One row per measure and alternative, with status, units and the priorities used. */
export function resultsCsv(plan: PlanResult, weights: Weights): string {
  const rows: (string | number)[][] = [["section", "measure", "alternative", "value", "formatted", "units", "status", "source"]];
  for (const m of METRICS) {
    for (const r of plan.routes) {
      const v = m.get(r);
      rows.push(["measure", m.label, r.label, Number.isFinite(v) ? +v.toFixed(4) : "", m.fmt(v), m.unit, STATUS_LABEL[m.status], m.source]);
    }
  }
  for (const r of plan.routes) {
    for (const [name, d, unit] of [["capital cost", r.simulation.cost, "US$"], ["time to opening", r.simulation.duration, "months"]] as const) {
      for (const p of ["p10", "p50", "p90"] as const) {
        rows.push(["distribution", `${name} ${p.toUpperCase()}`, r.label, Math.round(d[p]), name === "capital cost" ? usd(d[p]) : years(d[p]), unit, STATUS_LABEL.estimate, "RailPlanner Monte Carlo"]);
      }
    }
    r.stats.station_miles.forEach((st, k) =>
      rows.push(["station", `stop ${k + 1}`, r.label, Math.round(st.mile), st.name, "mile from origin", STATUS_LABEL.screening, "RailPlanner city list"]),
    );
  }
  const total = PRIORITIES.reduce((a, p) => a + (weights[p.id] ?? 0), 0) || 1;
  for (const p of PRIORITIES)
    rows.push(["priority", p.label, "", weights[p.id] ?? 0, `${Math.round((100 * (weights[p.id] ?? 0)) / total)}% of weight`, "weight (0-100)", STATUS_LABEL.assumption, "user"]);
  rank(plan.routes, weights).forEach((x, k) =>
    rows.push(["ranking", `position ${k + 1}`, plan.routes[x.index].label, +x.score.toFixed(2), x.score.toFixed(0), "score (0-100, relative)", STATUS_LABEL.assumption, "weighted measures"]),
  );
  rows.push(["meta", "corridor", "", "", `${plan.origin.name}, ${plan.origin.state} to ${plan.destination.name}, ${plan.destination.state}`, "", "", ""]);
  rows.push(["meta", "model version", "", "", plan.model_version, "", "", ""]);
  rows.push(["meta", "exported", "", "", new Date().toISOString(), "", "", ""]);
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
}
