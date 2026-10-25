// Text generated from the active scenario: the decision summary, per-alternative tradeoffs,
// unresolved questions and suggested Q&A prompts. Nothing here is hardcoded to a corridor, and
// every comparative claim is checked against the numbers before it is made.
import type { PlanResult, RouteResult } from "./api";
import { hm, list, miles, money, pct, people, usd, years } from "./format";
import { METRIC, type Metric } from "./metrics";
import { rank, type Weights } from "./scoring";

const MEANINGFUL = 0.03; // differences under 3% are treated as ties

// Differences smaller than these are not worth stating, however large in percentage terms (0 vs 1 mile).
const MIN_GAP: Record<string, number> = { envNew: 5, newTrack: 5, mountain: 5, length: 10, envMiles: 5, tripTime: 10 };

function better(m: Metric, a: number, b: number): boolean {
  if (Math.abs(a - b) < (MIN_GAP[m.id] ?? 0)) return false;
  if (m.direction === "lower") return a < b * (1 - MEANINGFUL);
  return a > b * (1 + MEANINGFUL);
}

/** Index of the best alternative on a measure, or -1 if any value is missing. */
function bestIndex(routes: RouteResult[], m: Metric, higher: boolean): number {
  const vals = routes.map(m.get);
  if (!vals.every(Number.isFinite)) return -1;
  const target = higher ? Math.max(...vals) : Math.min(...vals);
  return vals.indexOf(target);
}

/** Plain-language strengths, checked against every other alternative. */
function strengths(routes: RouteResult[], i: number): string[] {
  const r = routes[i];
  const others = routes.filter((_, j) => j !== i);
  // context measures (length, stations) need an explicit direction for "beats"
  const beatsAll = (id: string, dir: "lower" | "higher" = METRIC[id].direction === "lower" ? "lower" : "higher") =>
    others.every((o) => better({ ...METRIC[id], direction: dir }, METRIC[id].get(r), METRIC[id].get(o)));
  const out: string[] = [];
  if (beatsAll("cost")) out.push(`it has the lowest median capital cost (${usd(r.simulation.cost.p50)})`);
  if (beatsAll("duration")) out.push(`it has the shortest median time to opening (${years(r.simulation.duration.p50)})`);
  if (r.stats.row_reuse_pct >= 60 && others.every((o) => o.stats.row_reuse_pct < r.stats.row_reuse_pct))
    out.push(`it uses existing rail corridors for ${pct(r.stats.row_reuse_pct)} of its length`);
  if (beatsAll("popStations")) out.push(`it has the most residents near its stations (${people(r.stats.pop_near_stations)})`);
  if (beatsAll("envNew")) out.push(`it puts the least new track in flagged areas (${miles(r.stats.env_miles_new)})`);
  if (beatsAll("riders")) out.push(`it draws the most riders (about ${people(METRIC.riders.get(r))} a year, median)`);
  if (beatsAll("tripTime")) out.push(`it has the shortest train time end to end (${hm(METRIC.tripTime.get(r))})`);
  if (beatsAll("subsidy")) out.push(`it needs the least operating subsidy (${money(METRIC.subsidy.get(r))} a year, median)`);
  if (beatsAll("length", "lower")) out.push(`it is the shortest alignment (${miles(r.stats.length_miles)})`);
  if (beatsAll("stations")) out.push(`it reaches the most cities (${r.stats.stations.length} stations)`);
  return out;
}

/** Where another alternative is meaningfully better: "The direct alignment is shorter (748 vs 988 mi)". */
export function tradeoffs(routes: RouteResult[], i: number): string[] {
  const r = routes[i];
  const out: string[] = [];
  const checks: [string, string, (v: number) => string][] = [
    ["length", "is shorter", miles],
    ["stations", "reaches more cities", (v) => `${v} stations`],
    ["popStations", "has more residents near its stations", people],
    ["cost", "costs less", usd],
    ["duration", "opens sooner", years],
    ["envNew", "puts less new track in flagged areas", miles],
    ["riders", "draws more riders", people],
    ["tripTime", "is faster end to end", hm],
    ["subsidy", "needs less operating subsidy", money],
  ];
  for (const [id, phrase, fmt] of checks) {
    const m = METRIC[id];
    const j = bestIndex(routes, m, id === "stations" || m.direction === "higher");
    if (j >= 0 && j !== i && better({ ...m, direction: id === "stations" ? "higher" : m.direction }, m.get(routes[j]), m.get(r))) {
      out.push(`${routes[j].label} ${phrase} (${fmt(m.get(routes[j]))} vs ${fmt(m.get(r))})`);
    }
  }
  return out;
}

export interface DecisionSummary {
  leader: RouteResult;
  leaderIndex: number;
  headline: string;
  cost: string;
  schedule: string;
  reasons: string[];
  tradeoffs: string[];
  unresolved: string[];
  service: string | null;
  nextStep: string;
}

export function decisionSummary(plan: PlanResult, weights: Weights): DecisionSummary {
  const routes = plan.routes;
  const ranked = rank(routes, weights);
  const li = ranked[0].index;
  const L = routes[li];
  const c = L.simulation.cost;
  const d = L.simulation.duration;
  const reasons = strengths(routes, li).slice(0, 3);
  if (!reasons.length) reasons.push("it balances the weighted measures best, without leading on any single one");
  const sv = L.service && L.service.available ? L.service : null;
  const unresolved: string[] = [];
  if (sv && sv.riders) {
    unresolved.push(
      `Ridership is a preliminary estimate: about ${people(sv.riders.p50)} a year, but anywhere from ${people(sv.riders.p10)} to ${people(sv.riders.p90)} in the middle 80% of simulations.`,
    );
  } else {
    unresolved.push("Service estimates are not available for this alternative.");
  }
  unresolved.push(
    sv && sv.freight_share >= 0.3
      ? `About ${pct(sv.freight_share * 100)} of the route is on freight-owned track; access terms, capacity and reliability there are not assessed.`
      : L.stats.row_reuse_pct >= 50
        ? "Running on existing rail corridors requires access agreements and spare capacity from host railroads, neither of which is assessed."
        : `It needs ${miles(L.stats.miles_new)} of new right-of-way; land, structures and environmental review are only roughly costed.`,
  );
  if (sv && sv.subsidy) {
    unresolved.push(
      sv.subsidy.p50 > 0
        ? `Operations would need about ${usd(sv.subsidy.p50)} a year in public support (median), which needs a committed funding source.`
        : `Fares could cover operating costs in the median case, but the range runs from ${money(sv.subsidy.p10)} to ${money(sv.subsidy.p90)} a year.`,
    );
  }
  const service = sv
    ? `Assumed service: ${sv.round_trips} trains a day each way; ${L.stats.stations[0]} to ${L.stats.stations[L.stats.stations.length - 1]} in ${hm(sv.end_to_end_min)} by train (${hm(sv.end_to_end_car_min)} by car).`
    : null;
  const corridorId = L.funding.find((m) => m.program_id === "corridor_id" && m.eligible);
  return {
    leader: L,
    leaderIndex: li,
    headline: `${L.label} leads under the current model and priorities.`,
    cost: `Estimated median capital cost: ${usd(c.p50)} (middle 80% of modeled outcomes: ${usd(c.p10)}–${usd(c.p90)}).`,
    schedule: `Median time to opening: ${years(d.p50)} (${years(d.p10)}–${years(d.p90)}).`,
    reasons,
    tradeoffs: tradeoffs(routes, li).slice(0, 2),
    unresolved,
    service,
    nextStep: corridorId
      ? "Next step: enter the corridor in FRA's Corridor ID program and fund a service development plan covering service, ridership, operations and host-railroad capacity."
      : "Next step: commission a service development plan covering service, ridership, operations and host-railroad capacity.",
  };
}

export function summarySentence(s: DecisionSummary): string {
  const reasons = s.reasons.length ? ` It leads because ${list(s.reasons)}.` : "";
  const trade = s.tradeoffs.length ? ` Tradeoff: ${s.tradeoffs.join("; ")}.` : "";
  return `${s.headline} ${s.cost} ${s.schedule}${reasons}${trade}`;
}

/** What each alternative gains and gives up relative to the best of the others. */
export function gainGiveUp(routes: RouteResult[], i: number): { gain: string[]; give: string[] } {
  const gain = strengths(routes, i);
  const give = tradeoffs(routes, i);
  return { gain: gain.length ? gain : ["no single measure where it clearly leads"], give: give.length ? give : ["nothing major on the modeled measures"] };
}

/** Suggested questions whose premises are true for this scenario. */
export function suggestedQuestions(plan: PlanResult, selected: number): string[] {
  const r = plan.routes;
  const qs: string[] = [];
  const cheap = bestIndex(r, METRIC.cost, false);
  const dear = bestIndex(r, METRIC.cost, true);
  if (cheap >= 0 && cheap !== dear && better(METRIC.cost, METRIC.cost.get(r[cheap]), METRIC.cost.get(r[dear])))
    qs.push(`Why does ${r[cheap].label} cost less than ${r[dear].label}?`);
  const fast = bestIndex(r, METRIC.duration, false);
  const slow = bestIndex(r, METRIC.duration, true);
  if (fast >= 0 && fast !== slow && better(METRIC.duration, METRIC.duration.get(r[fast]), METRIC.duration.get(r[slow])))
    qs.push(`Why does ${r[slow].label} take longer to open than ${r[fast].label}?`);
  const short = bestIndex(r, METRIC.length, false);
  if (short >= 0 && cheap >= 0 && short !== cheap) qs.push(`${r[short].label} is the shortest. Why doesn't it cost the least?`);
  const sv = r[selected].service;
  if (sv && sv.available && sv.riders) qs.push(`What drives ridership on ${r[selected].label}, and how reliable is that estimate?`);
  if (sv && sv.available && sv.bcr)
    qs.push(`Why is the benefit-cost ratio of ${r[selected].label} ${sv.bcr.p50 < 1 ? "below" : "above"} 1?`);
  qs.push(`What drives the uncertainty in the cost of ${r[selected].label}?`);
  qs.push(`Which funding programs fit ${r[selected].label}, and what would remain for state and local sponsors?`);
  return qs.slice(0, 5);
}
