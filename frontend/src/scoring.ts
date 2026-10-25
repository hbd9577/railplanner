// Priority-weighted ranking of alternatives. Only modeled measures can be weighted; faster
// journeys, reliability and operating subsidy are listed but disabled until they are modeled.
import type { RouteResult } from "./api";
import { METRIC, type Metric } from "./metrics";

export interface Priority {
  id: string;
  label: string;
  metric: string; // id in METRICS
  help: string;
}

export const PRIORITIES: Priority[] = [
  { id: "cost", label: "Lower capital cost", metric: "cost", help: "Median simulated capital cost (illustrative)." },
  { id: "delivery", label: "Faster delivery", metric: "duration", help: "Median simulated time to opening." },
  { id: "access", label: "More residents near stations", metric: "popStations",
    help: "Residents within 10 km of a station. Only one population measure is weighted, to avoid double counting." },
  { id: "environment", label: "Less new track in flagged areas", metric: "envNew",
    help: "Miles of new track inside protected land, refuges or floodplain proxies. Existing track that already crosses them is not counted." },
  { id: "newTrack", label: "Less new right-of-way", metric: "newTrack",
    help: "Miles of new track. Partly overlaps with capital cost, so it is off by default." },
];

export const UNAVAILABLE_PRIORITIES = [
  { label: "Faster journeys", why: "Travel time is not modeled; alignment length is not a substitute." },
  { label: "Greater reliability", why: "Requires an operations simulation with freight traffic." },
  { label: "Lower operating subsidy", why: "Operating costs, fares and ridership are not modeled." },
];

export type Weights = Record<string, number>;

export const DEFAULT_WEIGHTS: Weights = { cost: 35, delivery: 20, access: 25, environment: 20, newTrack: 0 };

/**
 * Normalization: within the alternatives on screen, the best value of each measure scores 1.
 * Lower-is-better: best / value (values below 5% of the largest are floored there). Higher-is-better: value / best. Scores are therefore relative
 * to this set of alternatives and change if the set changes.
 */
export function normalized(routes: RouteResult[], m: Metric): number[] {
  const vals = routes.map(m.get);
  if (m.direction === "lower") {
    const max = Math.max(...vals);
    if (max <= 0) return vals.map(() => 1);
    const floor = 0.05 * max; // keeps a zero value from making every other alternative score 0
    const best = Math.max(Math.min(...vals), floor);
    return vals.map((v) => best / Math.max(v, floor));
  }
  const best = Math.max(...vals);
  return vals.map((v) => (best > 0 ? v / best : 1));
}

export interface Ranked {
  index: number;
  score: number; // 0-100
  contributions: Record<string, number>; // points contributed by each priority
}

/** Priorities that cannot be scored because a value is missing for some alternative. */
export function missingPriorities(routes: RouteResult[]): Priority[] {
  return PRIORITIES.filter((p) => routes.some((r) => !Number.isFinite(METRIC[p.metric].get(r))));
}

/**
 * Weighted ranking. A priority with a missing value for any alternative is left out entirely (and
 * reported by missingPriorities), so missing data can never make an alternative look better.
 */
export function rank(routes: RouteResult[], weights: Weights): Ranked[] {
  const missing = new Set(missingPriorities(routes).map((p) => p.id));
  const active = PRIORITIES.filter((p) => (weights[p.id] ?? 0) > 0 && !missing.has(p.id));
  const total = active.reduce((a, p) => a + weights[p.id], 0) || 1;
  const norms = Object.fromEntries(active.map((p) => [p.id, normalized(routes, METRIC[p.metric])]));
  return routes
    .map((_, i) => {
      const contributions: Record<string, number> = {};
      for (const p of active) contributions[p.id] = (100 * weights[p.id] * norms[p.id][i]) / total;
      return { index: i, score: Object.values(contributions).reduce((a, b) => a + b, 0), contributions };
    })
    .sort((a, b) => b.score - a.score);
}

export function weightsEqual(a: Weights, b: Weights): boolean {
  return PRIORITIES.every((p) => (a[p.id] ?? 0) === (b[p.id] ?? 0));
}

export function encodeWeights(w: Weights): string {
  return PRIORITIES.map((p) => w[p.id] ?? 0).join(".");
}

export function decodeWeights(s: string | null): Weights | null {
  if (!s) return null;
  const parts = s.split(".").map(Number);
  if (parts.length !== PRIORITIES.length || parts.some((n) => !Number.isFinite(n) || n < 0 || n > 100)) return null;
  return Object.fromEntries(PRIORITIES.map((p, i) => [p.id, parts[i]]));
}

/**
 * Why did the leader change between two weightings? Each priority's effect is its change in share of
 * the total weight times how much better the new leader scores on it than the old one; the
 * priorities that moved the most points toward the new leader are named.
 */
export function explainChange(routes: RouteResult[], before: Weights, after: Weights): string | null {
  const a = rank(routes, before)[0].index;
  const b = rank(routes, after)[0].index;
  if (a === b) return null;
  const missing = new Set(missingPriorities(routes).map((p) => p.id));
  const shareOf = (w: Weights) => {
    const t = PRIORITIES.filter((p) => !missing.has(p.id)).reduce((s, p) => s + (w[p.id] ?? 0), 0) || 1;
    return (id: string) => (missing.has(id) ? 0 : (w[id] ?? 0) / t);
  };
  const sb = shareOf(before);
  const sa = shareOf(after);
  const effects = PRIORITIES.filter((p) => !missing.has(p.id))
    .map((p) => {
      const n = normalized(routes, METRIC[p.metric]);
      const d = sa(p.id) - sb(p.id);
      return { p, d, effect: d * (n[b] - n[a]) };
    })
    .filter((x) => x.effect > 1e-6)
    .sort((x, y) => y.effect - x.effect)
    .slice(0, 2)
    .map((x) => `${x.d > 0 ? "more" : "less"} weight on “${x.p.label}”`);
  const why = effects.length ? `, mainly because of ${effects.join(" and ")}` : "";
  return `${routes[b].label} now leads instead of ${routes[a].label}${why}.`;
}

export interface Sensitivity {
  priority: Priority;
  current: number;
  /** Weight range (0-100, others unchanged) over which the current leader stays first. */
  holds: [number, number];
  /** Who leads just outside that range, if anyone else does. */
  below: number | null;
  above: number | null;
}

/** One-at-a-time sensitivity: how far each weight can move before the leader changes. */
export function sensitivity(routes: RouteResult[], weights: Weights): Sensitivity[] {
  const leader = rank(routes, weights)[0].index;
  const missing = new Set(missingPriorities(routes).map((p) => p.id));
  return PRIORITIES.filter((p) => !missing.has(p.id)).map((p) => {
    const current = weights[p.id] ?? 0;
    const leadAt = (w: number) => rank(routes, { ...weights, [p.id]: w })[0].index;
    let lo = current;
    while (lo > 0 && leadAt(lo - 1) === leader) lo--;
    let hi = current;
    while (hi < 100 && leadAt(hi + 1) === leader) hi++;
    return {
      priority: p,
      current,
      holds: [lo, hi],
      below: lo > 0 ? leadAt(lo - 1) : null,
      above: hi < 100 ? leadAt(hi + 1) : null,
    };
  });
}
