// Typed client for the FastAPI backend. Shapes mirror backend/app/models.py.
// In dev, Vite proxies /api -> :8000; in production, Caddy does the same.

export interface City {
  id: number;
  name: string;
  state: string;
  lat: number;
  lon: number;
  population: number | null;
}

export interface DemoPair {
  origin_id: number;
  dest_id: number;
  label: string;
}

export interface SegmentMiles {
  treatment: "new" | "upgrade" | "reactivation";
  terrain: string;
  density: string;
  miles: number;
}

export interface RouteStats {
  length_miles: number;
  population_served: number;
  buffer_miles: number;
  row_reuse_pct: number;
  mean_slope_pct: number;
  max_slope_pct: number;
  env_flag_count: number;
  env_flags: Record<string, number>;
  river_crossings: number;
  river_crossings_new: number;
  stations: string[];
  segments: SegmentMiles[];
  score: number;
  score_breakdown: { components: Record<string, number>; weights: Record<string, number> };
}

export interface HistogramBin {
  lo: number;
  hi: number;
  count: number;
}

export interface Distribution {
  unit: "usd" | "months";
  p10: number;
  p50: number;
  p90: number;
  mean: number;
  min: number;
  max: number;
  histogram: HistogramBin[];
}

export interface SimulationSummary {
  runs: number;
  source: "tiger_cagg" | "local";
  cost: Distribution;
  duration: Distribution;
}

export interface CostShare {
  basis_cost_usd: number;
  federal_usd: number;
  non_federal_usd: number;
  federal_pct: number;
  loan_usd: number;
}

export interface FundingMatch {
  program_id: string;
  program_name: string;
  agency: string;
  kind: "grant" | "loan" | "planning";
  eligible: boolean;
  fit_score: number;
  rationale: string;
  cost_share: CostShare;
}

export interface RouteResult {
  id: number | null;
  rank: number;
  key: string;
  label: string;
  description: string;
  geometry: { type: "LineString"; coordinates: [number, number][] };
  stats: RouteStats;
  simulation: SimulationSummary;
  funding: FundingMatch[];
}

export interface PlanResult {
  request_id: number | null;
  origin: City;
  destination: City;
  routes: RouteResult[];
  assumptions: string[];
  data_sources: Record<string, { source: string; flag: string }>;
  created_at: string;
  cached: boolean;
}

export interface ProposalResult {
  markdown: string;
  number_check?: { passed: boolean; unmatched: string[] };
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = (await res.json()).detail ?? detail;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, detail);
  }
  return res.json() as Promise<T>;
}

export const api = {
  cities: () => request<City[]>("/cities"),
  demoPairs: () => request<DemoPair[]>("/demo-pairs"),
  plan: (origin_id: number, dest_id: number, fresh = false) =>
    request<PlanResult>(`/plan${fresh ? "?fresh=true" : ""}`, {
      method: "POST",
      body: JSON.stringify({ origin_id, dest_id }),
    }),
  proposal: (requestId: number) => request<ProposalResult>(`/proposal/${requestId}`, { method: "POST" }),
  ask: (requestId: number, question: string) =>
    request<{ answer: string }>(`/ask/${requestId}`, { method: "POST", body: JSON.stringify({ question }) }),
  voice: async (text: string): Promise<Blob> => {
    const res = await fetch("/api/voice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new ApiError(res.status, "Voice narration unavailable");
    return res.blob();
  },
};
