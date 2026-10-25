// Metric registry: one definition per figure the app shows, with its provenance. Every table,
// card, tooltip and the methodology page read from here, so labels and caveats stay consistent.
import type { RouteResult } from "./api";
import { miles, pct, people, usd, years } from "./format";

export type Status = "calculated" | "estimate" | "approximate" | "rule-based" | "not-modeled";
export type Direction = "lower" | "higher" | "context";
export type Group = "Service" | "Demand" | "Access" | "Infrastructure" | "Cost" | "Schedule" | "Impacts" | "Funding";

export const STATUS_LABEL: Record<Status, string> = {
  calculated: "Calculated from data",
  estimate: "Illustrative estimate",
  approximate: "Approximate",
  "rule-based": "Rule-based",
  "not-modeled": "Not modeled",
};

export const STATUS_HELP: Record<Status, string> = {
  calculated: "Computed directly from public geographic data along the conceptual alignment.",
  estimate: "Produced by the Monte Carlo model from uncalibrated, illustrative inputs. Useful for comparing alternatives, not for budgeting.",
  approximate: "Uses a coarse or proxy data layer; treat as a screening flag only.",
  "rule-based": "Simple eligibility and fit rules from approximate program parameters; not an eligibility determination.",
  "not-modeled": "RailPlanner does not estimate this yet. It matters to the decision and needs the inputs listed.",
};

export interface Metric {
  id: string;
  label: string;
  short?: string;
  group: Group;
  unit: string;
  direction: Direction;
  status: Status;
  definition: string;
  source: string;
  dataYear: string;
  coverage: string;
  method: string;
  get: (r: RouteResult) => number;
  fmt: (v: number) => string;
}

const GRID = "1 km analysis grid, New York City/Philadelphia to Chicago";

export const METRICS: Metric[] = [
  {
    id: "length", label: "Alignment length", group: "Infrastructure", unit: "miles", direction: "context",
    status: "calculated",
    definition: "Length of the conceptual alignment from origin to destination. Shorter often means faster trips, but only an operations model can say how fast.",
    source: "Least-cost routing on RailPlanner's analysis grid", dataYear: "2020 Census; NTAD current release",
    coverage: GRID, method: "Smoothed least-cost path on 1 km cells; length of the smoothed line.",
    get: (r) => r.stats.length_miles, fmt: miles,
  },
  {
    id: "row", label: "Share on existing rail corridors", short: "On existing rail", group: "Infrastructure", unit: "%",
    direction: "context", status: "calculated",
    definition: "Share of the path that runs along existing (active or inactive) rail right-of-way. It does not establish ownership access, spare capacity, track condition or permission to operate.",
    source: "BTS NTAD North American Rail Network Lines", dataYear: "NTAD current release",
    coverage: "US rail lines in the analysis region", method: "Path cells touching an NTAD rail line.",
    get: (r) => r.stats.row_reuse_pct, fmt: (v) => pct(v, 1),
  },
  {
    id: "newTrack", label: "New track off existing corridors", short: "New track", group: "Infrastructure", unit: "miles",
    direction: "lower", status: "calculated",
    definition: "Miles that need new right-of-way: land acquisition, new structures and new environmental review.",
    source: "BTS NTAD rail lines", dataYear: "NTAD current release", coverage: GRID,
    method: "Path miles not on active or inactive rail right-of-way.",
    get: (r) => r.stats.miles_new, fmt: miles,
  },
  {
    id: "mountain", label: "New track in mountainous terrain", group: "Infrastructure", unit: "miles", direction: "lower",
    status: "calculated",
    definition: "New-track miles where mean slope is 8% or more. A proxy for tunnels, viaducts and grading cost, not a structure count.",
    source: "USGS 3DEP elevation", dataYear: "3DEP current", coverage: GRID,
    method: "Mean 250 m slope per 1 km cell along new-track sections.",
    get: (r) => r.stats.miles_new_mountainous, fmt: miles,
  },
  {
    id: "rivers", label: "Major river crossings", group: "Infrastructure", unit: "crossings", direction: "lower",
    status: "approximate",
    definition: "Times the path crosses a major river. Only rivers in Natural Earth 10m are included, so smaller crossings are missed.",
    source: "Natural Earth 10m rivers", dataYear: "Natural Earth 5.x", coverage: "Major rivers only",
    method: "Entries into river cells along the path.",
    get: (r) => r.stats.river_crossings, fmt: (v) => `${v}`,
  },
  {
    id: "stations", label: "Stations at known cities", short: "Stations", group: "Access", unit: "stations", direction: "context",
    status: "calculated",
    definition: "RailPlanner's 17 cities that lie within 5 km of the alignment. Real station sites, spacing and service patterns are not designed.",
    source: "RailPlanner city list", dataYear: "2020 Census populations", coverage: "17 cities in the region",
    method: "City point within 5 km of any path cell.",
    get: (r) => r.stats.stations.length, fmt: (v) => `${v}`,
  },
  {
    id: "popStations", label: "Residents near stations", group: "Access", unit: "people", direction: "higher",
    status: "calculated",
    definition: "Residents within 10 km (straight line) of any station, counted once where catchments overlap. A rough measure of who could reach the service; not a ridership forecast.",
    source: "US Census 2020 tracts (TIGERweb POP100)", dataYear: "2020", coverage: GRID,
    method: "Union of 10 km disks around station cells; sum of tract population rasterized to 1 km.",
    get: (r) => r.stats.pop_near_stations, fmt: people,
  },
  {
    id: "popLine", label: "Residents near the alignment", group: "Access", unit: "people", direction: "context",
    status: "calculated",
    definition: "Residents within 10 miles of the line, whether or not a station is nearby. A line can pass a large metro area without serving it. Not a ridership forecast.",
    source: "US Census 2020 tracts (TIGERweb POP100)", dataYear: "2020", coverage: GRID,
    method: "10-mile buffer around path cells; sum of rasterized tract population.",
    get: (r) => r.stats.population_served, fmt: people,
  },
  {
    id: "cost", label: "Capital cost (median, P50)", short: "Capital cost", group: "Cost", unit: "US$", direction: "lower",
    status: "estimate",
    definition: "Median of 5,000 simulated capital costs. Illustrative per-mile benchmarks; no cost year, inflation or escalation applied.",
    source: "RailPlanner Monte Carlo (cost_benchmarks.csv)", dataYear: "Illustrative benchmarks", coverage: "This alignment",
    method: "PERT draws by terrain, density and treatment, plus structures, crossings, stations, market factor and contingency.",
    get: (r) => r.simulation.cost.p50, fmt: usd,
  },
  {
    id: "costSpread", label: "Cost range (P90 − P10)", group: "Cost", unit: "US$", direction: "lower", status: "estimate",
    definition: "Width of the middle 80% of simulated costs. Wider means less certain within the model's own assumptions.",
    source: "RailPlanner Monte Carlo", dataYear: "Illustrative benchmarks", coverage: "This alignment",
    method: "P90 minus P10 from the cost distribution.",
    get: (r) => r.simulation.cost.p90 - r.simulation.cost.p10, fmt: usd,
  },
  {
    id: "duration", label: "Time to opening (median, P50)", short: "Time to opening", group: "Schedule", unit: "years",
    direction: "lower", status: "estimate",
    definition: "Median simulated time from the start of planning and environmental review to opening. Testing and commissioning are not modeled separately.",
    source: "RailPlanner Monte Carlo", dataYear: "Illustrative durations", coverage: "This alignment",
    method: "Triangular stage durations with overlaps; construction scales with simulated cost and length.",
    get: (r) => r.simulation.duration.p50, fmt: years,
  },
  {
    id: "envMiles", label: "Miles through flagged areas (all track)", group: "Impacts", unit: "miles", direction: "context",
    status: "approximate",
    definition: "Path miles inside protected land, wildlife refuges or floodplain proxies (a mile inside two layers counts in both). Flags show where to look, not impact severity; floodplain uses river corridors, not FEMA maps.",
    source: "USGS PAD-US 3.0 (GAP 1–2); Natural Earth rivers", dataYear: "PAD-US 3.0", coverage: GRID,
    method: "Path cells inside each flag layer, converted to miles.",
    get: (r) => Object.values(r.stats.env_miles ?? {}).reduce((a, b) => a + b, 0), fmt: (v) => miles(v),
  },
  {
    id: "envNew", label: "Flagged miles on new track", group: "Impacts", unit: "miles", direction: "lower",
    status: "approximate",
    definition: "Path miles inside protected land, wildlife refuges or floodplain proxies where new track would be built, each mile counted once. Upgrading track that already runs through a flagged area is excluded, since the railway is already there.",
    source: "USGS PAD-US 3.0 (GAP 1–2); Natural Earth rivers; BTS NTAD rail", dataYear: "PAD-US 3.0", coverage: GRID,
    method: "Path cells inside any flag layer and not on existing rail right-of-way, converted to miles.",
    get: (r) => r.stats.env_miles_new ?? 0, fmt: (v) => miles(v),
  },
  {
    id: "fundingTop", label: "Best federal program fit", group: "Funding", unit: "0–1", direction: "higher",
    status: "rule-based",
    definition: "Highest fit score among matched federal programs. A screening signal, not an eligibility determination or award estimate.",
    source: "funding_programs.json (approximate program parameters)", dataYear: "Approximate, current rounds",
    coverage: "Six federal programs", method: "Rules on project type, size and corridor location.",
    get: (r) => Math.max(0, ...r.funding.filter((m) => m.eligible).map((m) => m.fit_score)), fmt: (v) => v.toFixed(2),
  },
];

export const METRIC = Object.fromEntries(METRICS.map((m) => [m.id, m])) as Record<string, Metric>;

/** Decision-critical information RailPlanner does not estimate. Shown wherever it would matter. */
export interface Gap {
  id: string;
  label: string;
  group: Group;
  why: string;
  needs: string;
}

export const NOT_MODELED: Gap[] = [
  { id: "travelTime", label: "Door-to-door and in-train travel time", group: "Service",
    why: "Decides whether rail competes with driving, bus or flying for each trip.",
    needs: "Track geometry and speed limits, stopping pattern, rolling-stock performance, station access times and comparable times for other modes." },
  { id: "frequency", label: "Frequency, span and timetable", group: "Service",
    why: "Two trains a day and twelve trains a day are different services with different users.",
    needs: "Service plan, fleet size, crew and maintenance windows, and host-railroad paths." },
  { id: "demand", label: "Ridership and station-pair demand", group: "Demand",
    why: "Population near a line is not passengers; revenue, benefits and subsidy all follow from demand.",
    needs: "Travel survey or mobile data, a calibrated mode-choice model, fares and the service plan." },
  { id: "competitiveness", label: "Travel-time competitiveness by station pair", group: "Demand",
    why: "Intermediate city pairs often carry most of a corridor's trips.",
    needs: "Travel times by station pair for rail, car, bus and air with consistent access assumptions." },
  { id: "reliability", label: "Reliability and on-time performance", group: "Service",
    why: "Shared track with freight is the main source of intercity delay in the US.",
    needs: "Operations simulation with freight traffic, dispatching rules and recovery time." },
  { id: "capacity", label: "Capacity, freight conflicts and access agreements", group: "Infrastructure",
    why: "Existing rail corridors are mostly privately owned; access, paths and added tracks drive cost and schedule.",
    needs: "Host-railroad traffic data, capacity modeling and negotiated access terms." },
  { id: "operating", label: "Operating cost, revenue and annual subsidy", group: "Cost",
    why: "Determines the ongoing public support a state or sponsor must commit to every year.",
    needs: "Service plan, crew and fleet costs, maintenance-of-way costs, fares and ridership." },
  { id: "lifecycle", label: "Lifecycle cost, rolling stock and facilities", group: "Cost",
    why: "Trains, maintenance facilities, electrification and renewals are excluded from the capital estimate.",
    needs: "Fleet plan, facility sites, traction power choice and an analysis period with renewals." },
  { id: "bca", label: "Benefit-cost ratio and net present value", group: "Cost",
    why: "Federal capital programs weigh public benefits against costs.",
    needs: "Ridership, travel-time savings, safety and emissions effects, discount rate and analysis period." },
  { id: "emissions", label: "Emissions, safety and resilience outcomes", group: "Impacts",
    why: "Net climate and safety benefits depend on mode shift and operations, not on the alignment alone.",
    needs: "Mode-shift estimates, energy and fuel mix, grade-crossing exposure, hazard data." },
];
