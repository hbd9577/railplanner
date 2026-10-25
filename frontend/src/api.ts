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
  stations: string[]; // ordered along the route, origin first
  station_miles: { name: string; mile: number }[];
  pop_near_stations: number;
  station_catchment_km: number;
  miles_new: number;
  miles_upgrade: number;
  miles_reactivation: number;
  miles_new_mountainous: number;
  env_miles: Record<string, number>;
  env_miles_new: number;
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
  model_version: string;
}

export interface NumberCheck {
  passed: boolean;
  unmatched: string[];
}

export interface ProposalResult {
  markdown: string;
  number_check?: NumberCheck;
  source?: "gemini" | "cache" | "template";
}

export interface AskResult {
  answer: string;
  number_check?: NumberCheck;
}

export interface ProgramGuide {
  applicants: string;
  stage: string;
  match: string;
  limits: string;
  status: string;
  next_step: string;
  fit_rule: string;
  source_url: string;
  source_label: string;
  verified_on: string;
  verification: "verified" | "partial" | "unverified";
  unverified_fields: string[];
}

export interface FundingProgram {
  id: string;
  name: string;
  agency: string;
  kind: "grant" | "loan" | "planning";
  federal_match_pct: number;
  typical_award_usd: [number, number];
  guide?: ProgramGuide;
}

/** The active scenario as sent to the proposal and Q&A endpoints. */
export interface ScenarioPayload {
  priorities: { label: string; share_pct: number }[];
  ranking: string[];
  close_call: boolean;
  excluded_priorities: string[];
  selected: string | null;
  is_default: boolean;
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
  features: () =>
    request<{ features?: Record<string, boolean> }>("/health").then((h) => h.features ?? {}),
  demoPairs: () => request<DemoPair[]>("/demo-pairs"),
  fundingPrograms: () => request<FundingProgram[]>("/funding-programs"),
  plan: (origin_id: number, dest_id: number, fresh = false) =>
    request<PlanResult>(`/plan${fresh ? "?fresh=true" : ""}`, {
      method: "POST",
      body: JSON.stringify({ origin_id, dest_id }),
    }),
  proposal: (requestId: number, refresh = false, scenario?: ScenarioPayload) =>
    request<ProposalResult>(`/proposal/${requestId}${refresh ? "?refresh=true" : ""}`, {
      method: "POST",
      body: JSON.stringify({ scenario: scenario ?? null }),
    }),
  ask: (requestId: number, question: string, scenario?: ScenarioPayload, detail = false) =>
    request<AskResult>(`/ask/${requestId}`, {
      method: "POST",
      body: JSON.stringify({ question, scenario: scenario ?? null, detail }),
    }),
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
